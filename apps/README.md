# AppDeploy application source snapshots

The existing Agent-Live project at the repository root is preserved and unmodified. Three independently deployed AppDeploy applications are saved under `apps/`.

| Application | Source | Live AppDeploy deployment |
| --- | --- | --- |
| Hello ChatGPT | [hello-chatgpt](hello-chatgpt/) | https://hello-chatgpt-bi7lk5.v2.appdeploy.ai/ |
| Evidence Atlas | [evidence-atlas](evidence-atlas/) | https://evidence-atlas-m9m3c7.v2.appdeploy.ai/ |
| LabOS | [labos](labos/) | https://labos-9nm317.v2.appdeploy.ai/ |

Each directory contains its own frontend, backend, configuration, and test source snapshot.
The backend depends on the AppDeploy SDK and hosted authentication/database services; GitHub source alone is not a separate runtime deployment.
No user database contents, uploaded files, private credentials, or secrets were exported.
