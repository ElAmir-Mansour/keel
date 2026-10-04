import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { seed } from "./helpers";

// The assistant against a model that runs on this machine. A tiny server
// speaking the OpenAI Chat Completions protocol stands in for Ollama or LM
// Studio: it streams text, and when asked to create something it streams a
// tool call in fragments, the way real local runners do. The test drives the
// real panel through it, both through Keel's own relay and directly from the
// browser, and checks the approved action actually wrote the issue.

type ChatBody = { model: string; messages: { role: string; content: string | null; tool_calls?: unknown[] }[]; tools?: unknown[]; stream?: boolean };

function startMockModel() {
  const requests: ChatBody[] = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "mock-llm", object: "model" }] }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as ChatBody;
    requests.push(body);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const last = body.messages[body.messages.length - 1];
    const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
    if (last.role === "tool") {
      send({ choices: [{ delta: { content: "Done: the issue is in the backlog." }, finish_reason: null }] });
      send({ choices: [{ delta: {}, finish_reason: "stop" }] });
    } else if (body.tools?.length && /create an issue/i.test(String(lastUser?.content ?? ""))) {
      const args = JSON.stringify({ projectKey: "PLAT", issues: [{ title: "Rotate the backup key from the local model", description: null, priority: "high", dueDate: null, status: "backlog", points: 3 }] });
      send({ choices: [{ delta: { content: "I can add that. " }, finish_reason: null }] });
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_local_1", type: "function", function: { name: "create_issues", arguments: "" } }] }, finish_reason: null }] });
      for (const part of [args.slice(0, 20), args.slice(20, 70), args.slice(70)]) send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: part } }] }, finish_reason: null }] });
      send({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else {
      send({ choices: [{ delta: { content: "OK" }, finish_reason: null }] });
      send({ choices: [{ delta: {}, finish_reason: "stop" }] });
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
  return new Promise<{ url: string; requests: ChatBody[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://localhost:${port}/v1`, requests, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

async function useCustomModel(page: Page, url: string, transport: "auto" | "direct") {
  await page.evaluate(
    ({ url, transport }) => {
      localStorage.setItem("keel.ai.provider", "custom");
      localStorage.setItem("keel.ai.url.custom", url);
      localStorage.setItem("keel.ai.model.custom", "mock-llm");
      if (transport === "direct") localStorage.setItem("keel.ai.transport", "direct");
      else localStorage.removeItem("keel.ai.transport");
    },
    { url, transport },
  );
}

async function askToCreate(page: Page, mock: Awaited<ReturnType<typeof startMockModel>>) {
  await page.keyboard.press("a");
  const input = page.getByPlaceholder(/Ask about your vault/);
  await input.fill("Please create an issue to rotate the backup key");
  await input.press("Enter");
  await expect(page.getByText("I can add that.")).toBeVisible();
  await expect(page.getByText("Rotate the backup key from the local model")).toBeVisible();
  await page.getByRole("button", { name: "Apply", exact: true }).first().click();
  await expect(page.getByText("Done: the issue is in the backlog.")).toBeVisible();
  // The second request carried the tool result back in OpenAI's shape.
  const followUp = mock.requests[mock.requests.length - 1];
  expect(followUp.messages.some((m) => m.role === "tool")).toBe(true);
  expect(followUp.messages.some((m) => m.role === "assistant" && Array.isArray(m.tool_calls))).toBe(true);
}

for (const transport of ["auto", "direct"] as const) {
  test(`a local OpenAI-compatible model works ${transport === "auto" ? "through Keel's relay" : "directly from the browser"}, tools included`, async ({ page }) => {
    const mock = await startMockModel();
    try {
      await seed(page);
      await useCustomModel(page, mock.url, transport);
      await page.goto("/settings#ai");
      await expect(page.getByRole("combobox", { name: "Provider" })).toContainText("Custom");
      await page.getByRole("button", { name: "Load models" }).click();
      await expect(page.getByText(/1 models found/)).toBeVisible();
      await page.getByRole("button", { name: "Test connection" }).click();
      await expect(page.getByText(/Connected\./)).toBeVisible();
      await page.goto("/");
      await askToCreate(page, mock);
      await page.keyboard.press("Escape");
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByPlaceholder("Search or type a command…").fill("Rotate the backup key from the local model");
      await expect(page.getByRole("option", { name: /Rotate the backup key from the local model/ }).first()).toBeVisible();
      expect(mock.requests.every((r) => r.model === "mock-llm" && r.stream === true)).toBe(true);
    } finally {
      await mock.close();
    }
  });
}

test("switching providers keeps one key per provider and the panel names the model", async ({ page }) => {
  await seed(page);
  await page.goto("/settings#ai");
  const provider = page.getByRole("combobox", { name: "Provider" });
  await provider.click();
  await page.getByRole("option", { name: "OpenAI", exact: true }).click();
  await page.getByLabel("OpenAI API key").fill("sk-test-openai");
  await page.getByLabel("OpenAI API key").press("Enter");
  await expect(page.getByText("API key saved in this browser")).toBeVisible();
  await provider.click();
  await page.getByRole("option", { name: "Google Gemini" }).click();
  await expect(page.getByLabel("Google Gemini API key")).toHaveValue("");
  await provider.click();
  await page.getByRole("option", { name: "OpenAI", exact: true }).click();
  await expect(page.getByLabel("OpenAI API key")).toHaveValue("sk-test-openai");
  await provider.click();
  await page.getByRole("option", { name: /Ollama/ }).click();
  await expect(page.getByText("Works offline").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set up Ollama (one time)" })).toBeVisible();
});
