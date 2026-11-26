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


    def _config(self, deploy, **overrides):
        env = {"DEPLOY_TOKEN": "test-token"}
        with mock.patch.dict(os.environ, env, clear=True):
            config = deploy.load_deploy_config()
        return config if not overrides else type(config)(**{**config.__dict__, **overrides})

    def test_part_size_defaults_to_8_mib_and_reads_env(self):
        deploy = _load_deploy_module()
        self.assertEqual(self._config(deploy).part_max_bytes, 8 * 1024 * 1024)
        with mock.patch.dict(os.environ, {"DEPLOY_TOKEN": "t", "DEPLOY_PART_MAX_MB": "2.5"}, clear=True):
            self.assertEqual(deploy.load_deploy_config().part_max_bytes, int(2.5 * 1024 * 1024))
        with mock.patch.dict(os.environ, {"DEPLOY_TOKEN": "t", "DEPLOY_PART_MAX_MB": "lots"}, clear=True):
            with self.assertRaises(SystemExit):
                deploy.load_deploy_config()

    def test_plan_parts_puts_index_html_last_and_alone(self):
        deploy = _load_deploy_module()
        files = [("a.js", b"x" * 10), ("index.html", b"<html>"), ("b.js", b"x" * 10), ("c.wasm", b"x" * 25)]
        parts = deploy.plan_parts(files, 20)
        self.assertEqual([[n for n, _ in p] for p in parts], [["a.js", "b.js"], ["c.wasm"], ["index.html"]])

    def test_plan_parts_oversized_file_is_its_own_part_and_zero_means_one_bundle(self):
        deploy = _load_deploy_module()
        files = [("small.js", b"x"), ("model.onnx", b"x" * 100), ("small2.js", b"x")]
        parts = deploy.plan_parts(files, 10)
        self.assertEqual([[n for n, _ in p] for p in parts], [["small.js"], ["model.onnx"], ["small2.js"]])
        self.assertEqual(len(deploy.plan_parts(files, 0)), 1)

    def test_upload_splits_a_refused_part_until_it_is_accepted(self):
        deploy = _load_deploy_module()
        config = self._config(deploy)

        def post(url, files, data, headers, timeout):
            import zipfile as zf
            import io as _io

            names = zf.ZipFile(_io.BytesIO(files["bundle"][1])).namelist()
            response = mock.Mock()
            if len(names) > 2:  # the "server" refuses bodies of more than two files
                response.status_code = 400
                response.text = '{"detail":"There was an error parsing the body"}'
                response.headers = {"server": "uvicorn"}
            else:
                response.status_code = 200
                response.json.return_value = {"uploaded": len(names), "failed": []}
            return response

        part = [(f"f{i}.js", b"x") for i in range(5)]
        with mock.patch.object(deploy.requests, "post", side_effect=post) as posted:
            self.assertTrue(deploy._upload_part(config, "http://x/bundle", "streetview", "part 1/1", part))
        # 5 refused, then 2 (ok) + 3 refused -> 1 (ok) + 2 (ok)
        self.assertEqual(posted.call_count, 5)

    def test_upload_gives_up_on_a_single_file_the_api_refuses(self):
        deploy = _load_deploy_module()
        config = self._config(deploy)
        refused = mock.Mock(status_code=413, text="too large", headers={"server": "nginx"})
        with mock.patch.object(deploy.requests, "post", return_value=refused) as posted:
            self.assertFalse(deploy._upload_part(config, "http://x/bundle", "streetview", "p", [("m.onnx", b"x")]))
        self.assertEqual(posted.call_count, 1)

    def test_upload_does_not_retry_an_auth_failure(self):
        deploy = _load_deploy_module()
        config = self._config(deploy)
        denied = mock.Mock(status_code=401, text="no", headers={})
        with mock.patch.object(deploy.requests, "post", return_value=denied) as posted:
            self.assertFalse(deploy._upload_part(config, "http://x/bundle", "streetview", "p", [("a.js", b"x"), ("b.js", b"x")]))
        self.assertEqual(posted.call_count, 1)


if __name__ == "__main__":
    unittest.main()
