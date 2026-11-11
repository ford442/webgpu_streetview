import importlib.util
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


def _load_deploy_module():
    repo_root = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location("deploy", repo_root / "deploy.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["deploy"] = module
    spec.loader.exec_module(module)
    return module


class DeploySecretsTest(unittest.TestCase):
    def test_refuse_if_secrets_in_source_passes_clean_tree(self):
        deploy = _load_deploy_module()
        deploy.refuse_if_secrets_in_source(Path(__file__).resolve().parent)

    def test_refuse_if_legacy_deploy_old_present(self):
        deploy = _load_deploy_module()
        repo = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(repo / "scripts", root / "scripts")
            (root / "deploy.py").write_text("# stub deploy script\n", encoding="utf-8")
            (root / "deploy_old.py").write_text("# legacy\n", encoding="utf-8")
            with self.assertRaises(SystemExit):
                deploy.refuse_if_secrets_in_source(root)

    def test_load_deploy_config_requires_token(self):
        deploy = _load_deploy_module()
        env = {k: v for k, v in os.environ.items() if k != "DEPLOY_TOKEN"}
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(SystemExit):
                deploy.load_deploy_config()

    def test_load_deploy_config_reads_env(self):
        deploy = _load_deploy_module()
        with mock.patch.dict(
            os.environ,
            {
                "DEPLOY_TOKEN": "test-token",
                "DEPLOY_TARGET": "go",
                "MAPS_API_KEY": "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
                "CESIUM_ION_TOKEN": "test-ion-token",
            },
            clear=True,
        ):
            config = deploy.load_deploy_config()
            self.assertEqual(config.deploy_token, "test-token")
            self.assertEqual(config.deploy_target, "go")
            self.assertEqual(config.maps_api_key, "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345")
            self.assertEqual(config.cesium_ion_token, "test-ion-token")

    def test_load_deploy_config_cesium_ion_token_optional(self):
        deploy = _load_deploy_module()
        env = {k: v for k, v in os.environ.items() if k != "CESIUM_ION_TOKEN"}
        env["DEPLOY_TOKEN"] = "test-token"
        with mock.patch.dict(os.environ, env, clear=True):
            config = deploy.load_deploy_config()
            self.assertIsNone(config.cesium_ion_token)

    def test_inject_cesium_ion_token_replaces_sentinel(self):
        deploy = _load_deploy_module()
        bundle = f'const t="{deploy.CESIUM_ION_TOKEN_SENTINEL}";'.encode("utf-8")
        patched = deploy._inject_cesium_ion_token_into_bundle(bundle, "real-ion-token")
        self.assertIn(b'"real-ion-token"', patched)
        self.assertNotIn(deploy.CESIUM_ION_TOKEN_SENTINEL.encode("utf-8"), patched)

    def test_inject_cesium_ion_token_prepends_when_sentinel_absent(self):
        deploy = _load_deploy_module()
        bundle = b"console.log('no sentinel here');"
        patched = deploy._inject_cesium_ion_token_into_bundle(bundle, "real-ion-token")
        self.assertIn(b'window.CESIUM_ION_TOKEN="real-ion-token";', patched)

    def test_dry_run_needs_no_token(self):
        deploy = _load_deploy_module()
        env = {k: v for k, v in os.environ.items() if k != "DEPLOY_TOKEN"}
        with mock.patch.dict(os.environ, env, clear=True):
            config = deploy.load_deploy_config(dry_run=True)
        self.assertEqual(config.deploy_token, "")

    def test_dry_run_builds_the_zip_and_uploads_nothing(self):
        deploy = _load_deploy_module()
        with tempfile.TemporaryDirectory() as tmp:
            build = Path(tmp) / "build"
            (build / "models").mkdir(parents=True)
            (build / "index.html").write_text("<html></html>", encoding="utf-8")
            (build / "models" / "big.onnx").write_bytes(os.urandom(64 * 1024))
            out = Path(tmp) / "bundle.zip"
            env = {k: v for k, v in os.environ.items() if k != "DEPLOY_TOKEN"}
            with mock.patch.dict(os.environ, env, clear=True):
                config = deploy.load_deploy_config(dry_run=True)
            with mock.patch.object(deploy.requests, "post") as post:
                self.assertTrue(deploy.deploy_bundle(config, build, dry_run=True, out=out))
                post.assert_not_called()
            largest = deploy.describe_zip(out.read_bytes())
            self.assertEqual(largest[0][0], "models/big.onnx")
            self.assertEqual(largest[0][2], 64 * 1024)


if __name__ == "__main__":
    unittest.main()
