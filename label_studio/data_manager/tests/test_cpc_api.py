import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from data_manager.cpc_api import TaskCPCAPI
from django.test import SimpleTestCase, override_settings
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError


class CPCApiTests(SimpleTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.image = self.root / '2019' / 'coral.JPG'
        self.image.parent.mkdir()
        self.image.touch()
        self.task = SimpleNamespace(
            project=SimpleNamespace(workflow_feature_enabled=Mock(return_value=True)), has_permission=Mock(return_value=True),
            data={'image': '/data/local-files/?d=2019/coral.JPG'},
        )
        self.request = SimpleNamespace(user=object(), query_params={})
        self.lookup = patch('data_manager.cpc_api.get_object_or_404', return_value=self.task)
        self.lookup.start()
        self.addCleanup(self.lookup.stop)
        self.settings_override = override_settings(LOCAL_FILES_DOCUMENT_ROOT=str(self.root))
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)

    def test_denies_other_users_before_resolving_files(self):
        self.task.has_permission.return_value = False
        with patch('data_manager.cpc_api.project_local_files_resolver') as resolver:
            with self.assertRaises(PermissionDenied):
                TaskCPCAPI().get(self.request, 1)
            resolver.assert_not_called()

    def test_disabled_integration_does_not_resolve_sidecars(self):
        self.task.project.workflow_feature_enabled.return_value = False
        with patch('data_manager.cpc_api.project_local_files_resolver') as resolver:
            with self.assertRaises(NotFound):
                TaskCPCAPI().get(self.request, 1)
            resolver.assert_not_called()

    def test_requires_project_storage_access(self):
        with patch('data_manager.cpc_api.project_local_files_resolver', return_value=lambda path: None):
            with self.assertRaises(NotFound):
                TaskCPCAPI().get(self.request, 1)

    def test_does_not_accept_an_arbitrary_path_from_request(self):
        self.request.query_params = {'path': 'secret.cpc'}
        self.task.data = {'image': 'https://example.com/image.JPG'}
        with self.assertRaises(ValidationError):
            TaskCPCAPI().get(self.request, 1)

    def test_loads_authorized_sidecar(self):
        resolver = Mock(return_value=str(self.image))
        with patch('data_manager.cpc_api.project_local_files_resolver', return_value=resolver):
            with patch('data_manager.cpc_api.load_overlay', return_value={'points': []}) as loader:
                response = TaskCPCAPI().get(self.request, 1)
                loader.assert_called_once_with(str(self.image), self.root.resolve())
                self.assertEqual(response.data, {'points': []})
                self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_resolves_local_import_placeholder_without_mutating_task(self):
        self.task.project = SimpleNamespace(data_types={'image': 'Image'}, workflow_feature_enabled=Mock(return_value=True))
        self.task.data = {'$undefined$': '/data/local-files/?d=2019/coral.JPG'}
        with patch('data_manager.cpc_api.project_local_files_resolver', return_value=lambda path: str(self.image)):
            with patch('data_manager.cpc_api.load_overlay', return_value={'points': []}):
                self.assertEqual(TaskCPCAPI().get(self.request, 1).data, {'points': []})
        self.assertIn('$undefined$', self.task.data)

    def test_rejects_resolved_path_outside_document_root(self):
        with patch('data_manager.cpc_api.project_local_files_resolver', return_value=lambda path: str(self.root.parent / 'secret.JPG')):
            with self.assertRaises(NotFound):
                TaskCPCAPI().get(self.request, 1)

    def test_rejects_negative_multi_image_index(self):
        self.task.data['image'] = [self.task.data['image']]
        self.request.query_params = {'index': '-1'}
        with self.assertRaises(ValidationError):
            TaskCPCAPI().get(self.request, 1)
