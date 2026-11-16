"""install.sh: what it writes and refuses. Docker itself is never run here (--print and --dry-run only)."""

import os
import shutil
import subprocess
import tempfile
import unittest

HUB = os.path.join(os.path.dirname(__file__), "..")


class InstallScriptTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        shutil.copy(os.path.join(HUB, "install.sh"), self.dir)
        # A PATH with only what the script needs, so these tests can never find (or run) a Docker on this machine.
        self.bin = tempfile.mkdtemp()
        for tool in ("uname", "dirname", "sed", "cat", "tail", "awk", "hostname"):
            path = shutil.which(tool)
            if path:
                os.symlink(path, os.path.join(self.bin, tool))

    def tearDown(self):
        shutil.rmtree(self.dir)
        shutil.rmtree(self.bin)

    def run_script(self, *args):
        return subprocess.run(["/bin/sh", "install.sh", *args], cwd=self.dir, capture_output=True, text=True, timeout=20,
                              env={"PATH": self.bin})

    def test_print_shows_and_changes_nothing(self):
        done = self.run_script("--print", "--name", "My hub", "--port", "9000", "--usb", "/dev/video0", "--usb", "/dev/video2")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("LOOKABOUT_HUB_NAME=My hub\nLOOKABOUT_HUB_PORT=9000", done.stdout)
        self.assertIn("- /dev/video2:/dev/video2", done.stdout)
        self.assertIn("docker compose up -d --build", done.stdout)
        self.assertEqual(sorted(os.listdir(self.dir)), ["install.sh"])

    def test_dry_run_writes_the_files(self):
        done = self.run_script("--dry-run", "--name", "Shed", "--usb", "/dev/video0")
        self.assertEqual(done.returncode, 0, done.stderr)
        with open(os.path.join(self.dir, ".env")) as f:
            self.assertEqual(f.read(), "LOOKABOUT_HUB_NAME=Shed\nLOOKABOUT_HUB_PORT=8787\n")
        with open(os.path.join(self.dir, "docker-compose.override.yml")) as f:
            self.assertEqual(f.read(), "services:\n  hub:\n    devices:\n      - /dev/video0:/dev/video0\n")
        self.assertIn("not starting Docker", done.stdout)

    def test_no_usb_no_override(self):
        self.run_script("--dry-run")
        self.assertFalse(os.path.exists(os.path.join(self.dir, "docker-compose.override.yml")))

    def test_bad_input_is_refused(self):
        for args in (("--port", "http"), ("--port", ""), ("--name", ""), ("--name", 'a"b'), ("--name", "a$b"), ("--name", "a`b"),
                     ("--usb", "/etc/passwd"), ("--usb", "/dev/video0 -f"), ("--nope",)):
            done = self.run_script("--print", *args)
            self.assertEqual(done.returncode, 2, args)
        self.assertEqual(sorted(os.listdir(self.dir)), ["install.sh"])

    def test_without_docker_it_says_what_to_do(self):
        done = self.run_script()
        self.assertEqual(done.returncode, 1)
        self.assertIn("--install-docker", done.stderr)
        self.assertEqual(sorted(os.listdir(self.dir)), ["install.sh"])

    def test_help(self):
        done = self.run_script("--help")
        self.assertEqual(done.returncode, 0)
        self.assertIn("get.docker.com", done.stdout)

    def test_compose_file_reads_the_env(self):
        with open(os.path.join(HUB, "docker-compose.yml")) as f:
            text = f.read()
        for wanted in ("${LOOKABOUT_HUB_NAME:-lookabout-hub}", "${LOOKABOUT_HUB_PORT:-8787}", "LOOKABOUT_IN_CONTAINER", "network_mode: host"):
            self.assertIn(wanted, text)


if __name__ == "__main__":
    unittest.main()
