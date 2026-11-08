"""Installation defaults for optional fork features; project choices take precedence."""
import json
from pathlib import Path

DEFAULTS = {'cpc_integration': False, 'folder_navigation': False, 'labels_panel': False}
LOCAL_CONFIG = Path(__file__).resolve().parents[2] / 'workflow.local.json'


def load_workflow_defaults(path=LOCAL_CONFIG):
    try:
        values = json.loads(Path(path).read_text(encoding='utf-8'))
    except FileNotFoundError:
        return dict(DEFAULTS)
    if not isinstance(values, dict):
        raise ValueError('Workflow defaults must be a JSON object')
    for key, value in values.items():
        if key not in DEFAULTS or not isinstance(value, bool):
            raise ValueError(f'Invalid workflow default: {key}')
    return {**DEFAULTS, **values}
