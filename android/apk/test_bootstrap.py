"""Compile and exercise Java bootstrap with host adapters (no Android device)."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class BootstrapTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('javac'), 'JDK required')
    def test_checksum_failure_retry_marker_and_existing_install(self):
        sources = {
            'android/content/Context.java': '''package android.content;
public class Context {
 public final java.io.File assets;
 public Context(java.io.File assets) { this.assets=assets; }
 public Context getAssets() { return this; }
 public java.io.InputStream open(String name) throws Exception { return new java.io.FileInputStream(new java.io.File(assets,name)); }
}''',
            'com/deepseekharness/app/runtime/ProotBootstrap.java': '''package com.deepseekharness.app.runtime;
public class ProotBootstrap {
 public final java.io.File root;
 public ProotBootstrap(java.io.File root) { this.root=root; }
 public java.io.File getRootfsDir() { return root; }
 public Process execRootfsForInstall(String command) { return null; }
}''',
            'com/deepseekharness/app/util/Compat.java': '''package com.deepseekharness.app.util;
public class Compat {
 public static void write(java.io.File file, byte[] data) throws Exception { java.nio.file.Files.write(file.toPath(),data); }
 public static void destroy(Process p) { }
}''',
            'com/deepseekharness/app/util/InstallProcess.java': '''package com.deepseekharness.app.util;
public class InstallProcess {
 public static int result=0, calls=0;
 public static int read(Process p,long timeout,boolean b,java.util.function.BooleanSupplier cancelled,
   java.util.function.Consumer<String> status,java.util.function.Consumer<Process> destroy) { calls++; return result; }
}''',
            'BootstrapCheck.java': '''import java.nio.file.*;
import com.deepseekharness.app.core.TavernBootstrap;
import com.deepseekharness.app.runtime.ProotBootstrap;
import com.deepseekharness.app.util.InstallProcess;
public class BootstrapCheck {
 static void check(boolean value) { if(!value) throw new AssertionError(); }
 public static void main(String[] args) throws Exception {
  Path home=Path.of(args[0]), assets=home.resolve("assets"), root=home.resolve("rootfs");
  Files.createDirectories(assets); Files.createDirectories(root.resolve("root/.dsh/profiles/tavern"));
  Files.createDirectories(root.resolve("root/.dsh/apps/dsh-tavern/bin"));
  Path marker=root.resolve("root/.dsh/tavern-apk-installed");
  Files.writeString(assets.resolve("tavern-payload.tar.gz"),"payload");
  Files.writeString(assets.resolve("tavern-payload.sha256"),"corrupt");
  Files.writeString(assets.resolve("tavern-apk-setup.sh"),"setup");
  var context=new android.content.Context(assets.toFile()); var boot=new ProotBootstrap(root.toFile());
  try { TavernBootstrap.ensure(context,boot,()->false,s->{}); throw new AssertionError(); }
  catch(java.io.IOException expected) { check(!Files.exists(marker)); check(InstallProcess.calls==0); }
  var digest=java.security.MessageDigest.getInstance("SHA-256").digest("payload".getBytes());
  Files.writeString(assets.resolve("tavern-payload.sha256"),java.util.HexFormat.of().formatHex(digest));
  try { TavernBootstrap.ensure(context,boot,()->true,s->{}); throw new AssertionError(); }
  catch(java.io.IOException expected) { check(!Files.exists(marker)); }
  InstallProcess.result=1;
  try { TavernBootstrap.ensure(context,boot,()->false,s->{}); throw new AssertionError(); }
  catch(java.io.IOException expected) { check(!Files.exists(marker)); }
  InstallProcess.result=0;
  try { TavernBootstrap.ensure(context,boot,()->false,s->{}); throw new AssertionError(); }
  catch(java.io.IOException expected) { check(!Files.exists(marker)); }
  Files.writeString(root.resolve("root/.dsh/profiles/tavern/package.json"),"{}");
  Files.writeString(root.resolve("root/.dsh/apps/dsh-tavern/bin/dsh-tavern.mjs"),"source");
  TavernBootstrap.ensure(context,boot,()->false,s->{});
  check(Files.exists(marker)); check(!Files.exists(root.resolve("root/tavern-payload.tar.gz")));
  int calls=InstallProcess.calls; Files.delete(assets.resolve("tavern-payload.tar.gz"));
  TavernBootstrap.ensure(context,boot,()->false,s->{}); check(calls==InstallProcess.calls);
 }
}''',
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, content in sources.items():
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(content, encoding='utf-8')
            target = root / 'com/deepseekharness/app/core/TavernBootstrap.java'
            target.parent.mkdir(parents=True)
            shutil.copyfile(HERE / 'TavernBootstrap.java', target)
            subprocess.run(['javac', '-encoding', 'UTF-8', '-d', str(root),
                            *map(str, root.rglob('*.java'))], check=True)
            subprocess.run(['java', '-cp', str(root), 'BootstrapCheck', str(root / 'state')], check=True)


if __name__ == '__main__':
    unittest.main()
