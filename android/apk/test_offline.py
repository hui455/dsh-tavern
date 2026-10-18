"""Host-side packaging and retry tests; does not substitute for ARM64 smoke."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('payload', HERE / 'build-payload.py')
payload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(payload)


class OfflineTests(unittest.TestCase):
    def test_archive_uses_current_tracked_source_without_local_secrets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            (root / 'start.sh').write_bytes(b'echo old\r\n')
            subprocess.run(['git', '-C', str(root), 'add', 'start.sh'], check=True)
            (root / 'start.sh').write_bytes(b'echo current\r\n')
            (root / '.env').write_text('SECRET=not-for-apk')
            previous = payload.ROOT
            try:
                payload.ROOT = root
                payload.source_archive(root / 'source.tgz')
            finally:
                payload.ROOT = previous
            with tarfile.open(root / 'source.tgz') as archive:
                self.assertEqual(archive.getnames(), ['root/.dsh/apps/dsh-tavern/start.sh'])
                self.assertEqual(archive.extractfile(archive.getmembers()[0]).read(), b'echo current\n')
                self.assertEqual(archive.getmembers()[0].mode, 0o755)

    @unittest.skipIf(os.name == 'nt', 'Run shell integration under Linux/WSL')
    def test_local_extraction_retry_and_existing_data_preservation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tree = root / 'tree'
            for entry in ['apps/dsh-tavern', 'profiles/tavern', 'runtime/tavern-pnpm']:
                (tree / entry).mkdir(parents=True)
                (tree / entry / 'package.json').write_text('bundled')
            archive_path = root / 'payload.tgz'
            with tarfile.open(archive_path, 'w:gz') as archive:
                for entry in ['apps', 'profiles', 'runtime']:
                    archive.add(tree / entry, arcname=entry)
            commands = root / 'bin'
            commands.mkdir()
            for name in ['node', 'dsh']:
                command = commands / name
                command.write_text('#!/bin/sh\nexit "${TEST_EXIT:-0}"\n')
                command.chmod(0o755)
            home = root / 'home'
            env = {**os.environ, 'DSH_HOME': str(home), 'TAVERN_APK_PAYLOAD': str(archive_path),
                   'PATH': str(commands) + ':' + os.environ['PATH']}
            script = root / 'setup.sh'
            script.write_bytes((HERE / 'offline-setup.sh').read_bytes().replace(b'\r\n', b'\n'))
            def run(**changes):
                return subprocess.run(['bash', str(script)], env={**env, **changes}, capture_output=True)
            self.assertNotEqual(run(TEST_EXIT='7').returncode, 0)
            self.assertEqual(run().returncode, 0)
            (home / 'apps/dsh-tavern/package.json').write_text('newer user update')
            (home / 'settings.yaml').write_text('user config')
            (home / 'profile-data/tavern').mkdir(parents=True)
            (home / 'profile-data/tavern/save').write_text('saved game')
            self.assertEqual(run().returncode, 0)
            self.assertEqual((home / 'apps/dsh-tavern/package.json').read_text(), 'newer user update')
            self.assertEqual((home / 'settings.yaml').read_text(), 'user config')
            self.assertEqual((home / 'profile-data/tavern/save').read_text(), 'saved game')
            self.assertEqual(list(home.glob('.apk-install.*')), [])


if __name__ == '__main__':
    unittest.main()
