#!/usr/bin/env python3
"""Bake current tracked source in the exact ARM64 runtime shipped in the APK."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]


def source_archive(target):
    # Read working-tree contents of tracked files only: no local data, secrets,
    # Windows node_modules, ignored caches or unrelated untracked directories.
    paths = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z']).decode().split('\0')
    with tarfile.open(target, 'w:gz') as archive:
        for name in paths:
            if name and (ROOT / name).is_file():
                file = ROOT / name
                data = file.read_bytes()
                info = archive.gettarinfo(str(file), arcname='root/.dsh/apps/dsh-tavern/' + name)
                if file.suffix == '.sh':
                    data = data.replace(b'\r\n', b'\n')
                    info.mode = 0o755
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        revision = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], capture_output=True, text=True)
        if revision.returncode == 0:
            dirty = subprocess.check_output(['git', '-C', str(ROOT), 'status', '--porcelain', '--untracked-files=no'])
            data = json.dumps({'commit': revision.stdout.strip(), 'localChanges': bool(dirty),
                               'source': 'bundled-apk'}).encode()
            info = tarfile.TarInfo('root/.dsh/apps/dsh-tavern/.dsh-tavern-release.json')
            info.size = len(data)
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(data))


def build(assets):
    subprocess.run(['docker', 'info'], check=True, stdout=subprocess.DEVNULL, timeout=30)
    with tempfile.TemporaryDirectory(prefix='tavern-payload-', dir=assets.parent) as work:
        work = Path(work)
        rootfs = next((assets / name for name in ['offline-rootfs.bin', 'offline-rootfs.tar.gz',
                      'offline-rootfs.tar', 'offline-rootfs.tgz'] if (assets / name).is_file()), None)
        if rootfs is None or not (assets / 'dsh-runtime.bin').is_file():
            raise ValueError('缺少已验证的 DSHA split-runtime 资产')
        for source, name in [(rootfs, 'rootfs.tar'), (assets / 'dsh-runtime.bin', 'runtime.tar')]:
            # Fail early if upstream changes its archive format.
            with tarfile.open(source):
                pass
            shutil.copyfile(source, work / name)
        source_archive(work / 'source.tar.gz')
        for source, target in [('bake-payload.sh', 'bake.sh'), ('offline-setup.sh', 'offline-setup.sh')]:
            (work / target).write_bytes((ROOT / 'android/apk' / source).read_bytes().replace(b'\r\n', b'\n'))
        shutil.copyfile(ROOT / 'android/apk/smoke-offline.mjs', work / 'smoke-offline.mjs')
        (work / 'Dockerfile').write_text('''FROM scratch AS base
ADD rootfs.tar /
ADD runtime.tar /
ENV PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin
FROM base AS installer
ADD source.tar.gz /
COPY bake.sh /bake.sh
RUN ["/bin/bash", "/bake.sh"]
FROM base
COPY --from=installer /payload /payload
COPY offline-setup.sh /offline-setup.sh
COPY smoke-offline.mjs /smoke-offline.mjs
CMD ["/bin/bash"]
''')
        tag = 'dsh-tavern-payload:' + uuid.uuid4().hex
        smoke = 'tavern-offline-smoke-' + uuid.uuid4().hex
        container = None
        try:
            subprocess.run(['docker', 'build', '--platform=linux/arm64', '-t', tag, str(work)], check=True)
            # Fresh runtime, no installer state and no external network: exercise
            # exactly the on-device extraction plus actual Gateway HTTP startup.
            subprocess.run(['docker', 'run', '--name', smoke, '--rm', '--platform=linux/arm64', '--network=none', tag,
                            '/bin/bash', '-c', 'cp /payload/tavern-payload.tar.gz /root/ && '
                            'bash /offline-setup.sh && node /smoke-offline.mjs'], check=True, timeout=300)
            container = subprocess.check_output(['docker', 'create', '--platform=linux/arm64', tag], text=True).strip()
            subprocess.run(['docker', 'cp', container + ':/payload/tavern-payload.tar.gz', str(assets)], check=True)
        finally:
            subprocess.run(['docker', 'rm', '-f', smoke], check=False, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=30)
            if container:
                subprocess.run(['docker', 'rm', container], check=False)
            subprocess.run(['docker', 'image', 'rm', tag], check=False)
    payload = assets / 'tavern-payload.tar.gz'
    (assets / 'tavern-payload.sha256').write_text(hashlib.sha256(payload.read_bytes()).hexdigest() + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('assets', type=Path)
    build(parser.parse_args().assets.resolve())
