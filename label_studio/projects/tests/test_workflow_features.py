import json
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

from core.optional_features import load_workflow_defaults
from django.test import SimpleTestCase, override_settings
from projects.models import Project
from projects.serializers import ProjectSerializer
from data_manager.api import ProjectFoldersAPI


class WorkflowDefaultsTests(SimpleTestCase):
    def test_missing_local_config_defaults_off(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(load_workflow_defaults(Path(directory) / 'missing.json'), {
                'cpc_integration': False, 'folder_navigation': False, 'labels_panel': False,
            })

    def test_local_defaults_and_invalid_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'workflow.local.json'
            path.write_text(json.dumps({'cpc_integration': True, 'folder_navigation': True, 'labels_panel': True}))
            self.assertEqual(load_workflow_defaults(path), {
                'cpc_integration': True, 'folder_navigation': True, 'labels_panel': True,
            })
            path.write_text('{"cpc_integration": "false"}')
            with self.assertRaises(ValueError):
                load_workflow_defaults(path)

    @override_settings(WORKFLOW_DEFAULTS={'cpc_integration': True, 'folder_navigation': True, 'labels_panel': True})
    def test_explicit_project_choices_override_installation(self):
        project = Project()
        serializer = ProjectSerializer(project)
        for name in list(serializer.fields):
            if name not in ('cpc_integration', 'folder_navigation', 'labels_panel'):
                serializer.fields.pop(name)
        self.assertEqual(serializer.data, {'cpc_integration': True, 'folder_navigation': True, 'labels_panel': True})
        project.cpc_integration = False
        project.folder_navigation = False
        project.labels_panel = False
        self.assertFalse(project.workflow_feature_enabled('cpc_integration'))
        self.assertFalse(project.workflow_feature_enabled('folder_navigation'))
        serializer = ProjectSerializer(project)
        for name in list(serializer.fields):
            if name not in ('cpc_integration', 'folder_navigation', 'labels_panel'):
                serializer.fields.pop(name)
        self.assertEqual(serializer.data, {'cpc_integration': False, 'folder_navigation': False, 'labels_panel': False})

    @override_settings(WORKFLOW_DEFAULTS={'cpc_integration': False, 'folder_navigation': False, 'labels_panel': False})
    def test_project_can_opt_in_and_validate_saved_off(self):
        project = Project(cpc_integration=True, folder_navigation=True, labels_panel=True)
        self.assertTrue(project.workflow_feature_enabled('cpc_integration'))
        self.assertTrue(project.workflow_feature_enabled('folder_navigation'))
        serializer = ProjectSerializer(project, data={'cpc_integration': False, 'folder_navigation': False, 'labels_panel': False}, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertIs(serializer.validated_data['cpc_integration'], False)
        self.assertIs(serializer.validated_data['folder_navigation'], False)

    def test_disabled_folders_do_not_query_storage(self):
        project = Mock()
        project.workflow_feature_enabled.return_value = False
        view = ProjectFoldersAPI()
        view.check_object_permissions = Mock()
        request = Mock()
        with patch('data_manager.api.Project') as model, patch('data_manager.api.generics.get_object_or_404', return_value=project):
            with patch('io_storages.localfiles.models.LocalFilesImportStorageLink.objects.filter') as query:
                self.assertEqual(view.get(request, 1).data, {'folders': []})
                query.assert_not_called()
