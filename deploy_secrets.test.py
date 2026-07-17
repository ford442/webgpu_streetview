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
            },
            clear=True,
        ):
            config = deploy.load_deploy_config()
            self.assertEqual(config.deploy_token, "test-token")
            self.assertEqual(config.deploy_target, "go")
            self.assertEqual(config.maps_api_key, "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345")


if __name__ == "__main__":
    unittest.main()
