"""Authorized, read-only access to a task image's CPCE sidecar."""

from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from core.label_config import replace_task_data_undefined_with_config_field
from core.permissions import ViewClassPermission, all_permissions
from data_manager.cpc import load_overlay
from django.conf import settings
from io_storages.localfiles.functions import project_local_files_resolver
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView
from tasks.models import Task


class TaskCPCAPI(APIView):
    permission_required = ViewClassPermission(GET=all_permissions.tasks_view)

    def get(self, request, pk):
        task = get_object_or_404(Task.objects.select_related('project'), pk=pk)
        if not task.has_permission(request.user):
            raise PermissionDenied()
        if not task.project.workflow_feature_enabled('cpc_integration'):
            raise NotFound('CPC integration is disabled for this project')
        data = dict(task.data)
        replace_task_data_undefined_with_config_field(data, task.project)
        value = data.get(request.query_params.get('field', 'image'))
        if isinstance(value, list):
            try:
                index = int(request.query_params.get('index', '0'))
                value = value[index] if index >= 0 else None
            except (ValueError, IndexError):
                raise ValidationError('Invalid image index')
        if not isinstance(value, str):
            raise ValidationError('Select an image field from this task')
        url = urlsplit(value)
        relative = parse_qs(url.query).get('d', [None])[0]
        if not url.path.rstrip('/').endswith('/data/local-files') or not relative:
            raise ValidationError('CPCE overlays require a local-files image with a matching .cpc sidecar')
        resolver = project_local_files_resolver(task.project)
        image = resolver(relative)
        root = Path(settings.LOCAL_FILES_DOCUMENT_ROOT).resolve()
        if not image or not Path(image).resolve().is_relative_to(root):
            raise NotFound('Image is not available in this project’s local storage')
        # Recheck the canonical path to reject symlinks outside project storage.
        if not resolver(str(Path(image).resolve().relative_to(root))):
            raise NotFound('Image is not available in this project’s local storage')
        try:
            payload = load_overlay(image, root)
        except FileNotFoundError:
            raise NotFound('No matching .cpc file beside this image')
        except (ValueError, UnicodeError) as exc:
            raise ValidationError(str(exc))
        except OSError:
            raise ValidationError('Unable to read the CPCE files')
        response = Response(payload)
        response['Cache-Control'] = 'private, no-store'
        return response
