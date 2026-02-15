# cont

Tools for LLM

## Installation

```bash
/plugin marketplace add https://github.com/tyjeon24/cont
/plugin install cont
```

## Commands

- `/cont:hello` - Say hello to the world

## MCP Servers

### Jenkins

Interact with Jenkins CI/CD via REST API.

**Required environment variables:**

| Variable | Description |
|----------|-------------|
| `JENKINS_URL` | Base URL of your Jenkins instance (e.g. `https://jenkins.example.com`) |
| `JENKINS_USER` | Jenkins username |
| `JENKINS_TOKEN` | Jenkins API token (generate from Jenkins > User > Configure > API Token) |

**Available tools:**

| Tool | Description |
|------|-------------|
| `jenkins_get_job_info` | Get job information (status, last build, health) |
| `jenkins_get_build_info` | Get specific build details (result, duration, params) |
| `jenkins_get_params` | Read parameter definitions for a job |
| `jenkins_get_console_output` | Read build console output (log) |
| `jenkins_build` | Trigger a build without parameters |
| `jenkins_build_with_params` | Trigger a build with parameters |
| `jenkins_rebuild` | Rebuild a previous build with same parameters |
| `jenkins_get_queue_item` | Check queued build status |
