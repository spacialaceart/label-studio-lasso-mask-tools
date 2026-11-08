from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('projects', '0039_project_workflow_features')]
    operations = [
        migrations.AddField(
            model_name='project', name='labels_panel',
            field=models.BooleanField(default=None, null=True),
        ),
    ]
