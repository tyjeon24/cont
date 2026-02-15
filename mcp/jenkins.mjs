#!/usr/bin/env node

/**
 * Jenkins MCP Server
 *
 * Provides tools to interact with Jenkins CI/CD via its REST API.
 *
 * Required environment variables:
 *   JENKINS_URL   - Base URL of the Jenkins instance (e.g. https://jenkins.example.com)
 *   JENKINS_USER  - Jenkins username
 *   JENKINS_TOKEN - Jenkins API token
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";

const JENKINS_URL = (process.env.JENKINS_URL || "").replace(/\/+$/, "");
const JENKINS_USER = process.env.JENKINS_USER || "";
const JENKINS_TOKEN = process.env.JENKINS_TOKEN || "";

function authHeaders() {
  const encoded = Buffer.from(`${JENKINS_USER}:${JENKINS_TOKEN}`).toString("base64");
  return { Authorization: `Basic ${encoded}` };
}

/** Build the job path handling folders (a/b/c -> job/a/job/b/job/c) */
function jobPath(jobName) {
  return jobName
    .split("/")
    .map((s) => `job/${encodeURIComponent(s)}`)
    .join("/");
}

async function jenkins(path, options = {}) {
  const url = `${JENKINS_URL}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jenkins ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }
  return res;
}

// ── Server setup ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "jenkins",
  version: "0.1.0",
});

// ── Tool: get_job_info ──────────────────────────────────────────────────────

server.tool(
  "jenkins_get_job_info",
  "Get Jenkins job information including status, last build, health report",
  {
    job: z.string().describe("Job name (use / for folders, e.g. folder/job-name)"),
    tree: z
      .string()
      .optional()
      .describe("Optional tree filter to narrow response fields"),
  },
  async ({ job, tree }) => {
    const qs = tree ? `?tree=${encodeURIComponent(tree)}` : "";
    const res = await jenkins(`${jobPath(job)}/api/json${qs}`);
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Tool: get_build_info ────────────────────────────────────────────────────

server.tool(
  "jenkins_get_build_info",
  "Get information about a specific build (number, result, duration, parameters)",
  {
    job: z.string().describe("Job name (use / for folders)"),
    build: z
      .string()
      .default("lastBuild")
      .describe("Build number or alias (lastBuild, lastSuccessfulBuild, lastFailedBuild)"),
    tree: z.string().optional().describe("Optional tree filter"),
  },
  async ({ job, build, tree }) => {
    const qs = tree ? `?tree=${encodeURIComponent(tree)}` : "";
    const res = await jenkins(`${jobPath(job)}/${build}/api/json${qs}`);
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Tool: get_params ────────────────────────────────────────────────────────

server.tool(
  "jenkins_get_params",
  "Read parameter definitions for a Jenkins job (names, types, defaults)",
  {
    job: z.string().describe("Job name (use / for folders)"),
  },
  async ({ job }) => {
    const tree = "property[parameterDefinitions[name,type,defaultParameterValue[value],description,choices]]";
    const res = await jenkins(`${jobPath(job)}/api/json?tree=${encodeURIComponent(tree)}`);
    const data = await res.json();

    // Extract parameter definitions from properties
    const params = [];
    for (const prop of data.property || []) {
      if (prop.parameterDefinitions) {
        params.push(...prop.parameterDefinitions);
      }
    }

    if (params.length === 0) {
      return { content: [{ type: "text", text: "This job has no parameters defined." }] };
    }

    return { content: [{ type: "text", text: JSON.stringify(params, null, 2) }] };
  }
);

// ── Tool: get_console_output ────────────────────────────────────────────────

server.tool(
  "jenkins_get_console_output",
  "Read console output (build log) of a Jenkins build",
  {
    job: z.string().describe("Job name (use / for folders)"),
    build: z
      .string()
      .default("lastBuild")
      .describe("Build number or alias (lastBuild, lastSuccessfulBuild, etc.)"),
    tail: z
      .number()
      .optional()
      .describe("If set, return only the last N lines of output"),
  },
  async ({ job, build, tail }) => {
    const res = await jenkins(`${jobPath(job)}/${build}/consoleText`);
    let text = await res.text();

    if (tail && tail > 0) {
      const lines = text.split("\n");
      text = lines.slice(-tail).join("\n");
    }

    // Truncate if very large (>100KB)
    if (text.length > 100_000) {
      text = text.slice(-100_000);
      text = "[... truncated ...]\n" + text;
    }

    return { content: [{ type: "text", text }] };
  }
);

// ── Tool: build ─────────────────────────────────────────────────────────────

server.tool(
  "jenkins_build",
  "Trigger a Jenkins build without parameters",
  {
    job: z.string().describe("Job name (use / for folders)"),
  },
  async ({ job }) => {
    const res = await jenkins(`${jobPath(job)}/build`, { method: "POST" });
    const location = res.headers.get("location") || "";
    return {
      content: [
        {
          type: "text",
          text: `Build triggered successfully.\nQueue URL: ${location}\nPoll ${location}api/json to get the build number once scheduled.`,
        },
      ],
    };
  }
);

// ── Tool: build_with_params ─────────────────────────────────────────────────

server.tool(
  "jenkins_build_with_params",
  "Trigger a Jenkins build with parameters",
  {
    job: z.string().describe("Job name (use / for folders)"),
    params: z
      .record(z.string())
      .describe('Parameters as key-value pairs, e.g. {"ENVIRONMENT":"prod","VERSION":"1.2.3"}'),
  },
  async ({ job, params }) => {
    const body = new URLSearchParams(params).toString();
    const res = await jenkins(`${jobPath(job)}/buildWithParameters`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const location = res.headers.get("location") || "";
    return {
      content: [
        {
          type: "text",
          text: `Build triggered with parameters: ${JSON.stringify(params)}\nQueue URL: ${location}`,
        },
      ],
    };
  }
);

// ── Tool: rebuild ───────────────────────────────────────────────────────────

server.tool(
  "jenkins_rebuild",
  "Rebuild a specific Jenkins build by extracting its parameters and triggering a new build",
  {
    job: z.string().describe("Job name (use / for folders)"),
    build: z.string().describe("Build number to rebuild"),
  },
  async ({ job, build }) => {
    // Step 1: Get parameters from the original build
    const tree = "actions[parameters[name,value]]";
    const infoRes = await jenkins(
      `${jobPath(job)}/${build}/api/json?tree=${encodeURIComponent(tree)}`
    );
    const info = await infoRes.json();

    const params = {};
    for (const action of info.actions || []) {
      for (const p of action.parameters || []) {
        if (p.name && p.value !== undefined) {
          params[p.name] = String(p.value);
        }
      }
    }

    // Step 2: Trigger new build with extracted parameters
    let res;
    if (Object.keys(params).length > 0) {
      const body = new URLSearchParams(params).toString();
      res = await jenkins(`${jobPath(job)}/buildWithParameters`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } else {
      res = await jenkins(`${jobPath(job)}/build`, { method: "POST" });
    }

    const location = res.headers.get("location") || "";
    return {
      content: [
        {
          type: "text",
          text: `Rebuild of #${build} triggered.\nExtracted parameters: ${JSON.stringify(params)}\nQueue URL: ${location}`,
        },
      ],
    };
  }
);

// ── Tool: get_queue_item ────────────────────────────────────────────────────

server.tool(
  "jenkins_get_queue_item",
  "Check the status of a queued build to get the assigned build number",
  {
    queue_id: z.string().describe("Queue item ID (number from the queue URL)"),
  },
  async ({ queue_id }) => {
    const res = await jenkins(`queue/item/${queue_id}/api/json`);
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
