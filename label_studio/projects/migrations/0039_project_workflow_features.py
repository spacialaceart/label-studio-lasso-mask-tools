from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('projects', '0038_projectimport_list_indexes_async')]

    operations = [
        migrations.AddField(
            model_name='project', name='cpc_integration',
            field=models.BooleanField(default=None, null=True),
        ),
        migrations.AddField(
            model_name='project', name='folder_navigation',
            field=models.BooleanField(default=None, null=True),
        ),
    ]
