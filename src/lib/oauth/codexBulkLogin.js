import { chromium } from "playwright";
import { authenticator } from "otplib";
import { createProviderConnection } from "@/lib/localDb";
import { CODEX_CONFIG } from "@/lib/oauth/constants/oauth";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";
import { generatePKCE } from "@/lib/oauth/utils/pkce";
import { startLocalServer } from "@/lib/oauth/utils/server";

const WAIT_SHORT = 8000;
const WAIT_MEDIUM = 20000;
const CALLBACK_TIMEOUT = 180000;

function normalizeSecret(secret) {
  return String(secret || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function buildAuthUrl(redirectUri, state, codeChallenge) {
  const params = {
    response_type: "code",
    client_id: CODEX_CONFIG.clientId,
    redirect_uri: redirectUri,
    scope: CODEX_CONFIG.scope,
    code_challenge: codeChallenge,
    code_challenge_method: CODEX_CONFIG.codeChallengeMethod,
    ...CODEX_CONFIG.extraParams,
    state,
  };
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${CODEX_CONFIG.authorizeUrl}?${qs}`;
}

async function clickAny(page, texts) {
  for (const text of texts) {
    const button = page.getByRole("button", { name: new RegExp(text, "i") }).first();
    if (await button.count()) {
      await button.click({ timeout: WAIT_SHORT });
      return true;
    }
  }
  return false;
}

async function fillFirst(page, selectors, value) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      await el.fill(value, { timeout: WAIT_SHORT });
      return true;
    }
  }
  return false;
}

function parseList(raw) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  return lines.map((line, i) => {
    const parts = line.split("|").map((x) => x.trim());
    return {
      row: i + 1,
      email: parts[0] || "",
      password: parts[1] || "",
      totpSecret: parts[2] || "",
    };
  });
}

async function waitForCallbackCode() {
  return new Promise((resolve, reject) => {
    let callbackParams = null;
    startLocalServer((params) => {
      callbackParams = params;
    }, 1455)
      .then(({ close }) => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (callbackParams) {
            clearInterval(timer);
            close();
            resolve(callbackParams);
            return;
          }
          if (Date.now() - start > CALLBACK_TIMEOUT) {
            clearInterval(timer);
            close();
            reject(new Error("OAuth callback timeout"));
          }
        }, 200);
      })
      .catch(reject);
  });
}

async function exchangeToken({ code, codeVerifier, redirectUri }) {
  const res = await fetch(CODEX_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CODEX_CONFIG.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${await res.text()}`);
  }
  return res.json();
}

export async function runCodexBulkLogin({ accountsText, headless = false }) {
  const accounts = parseList(accountsText);
  if (!accounts.length) {
    throw new Error("No accounts provided");
  }

  const browser = await chromium.launch({ headless });
  const results = [];

  try {
    for (const account of accounts) {
      const item = { row: account.row, email: account.email, ok: false, message: "" };
      let context;
      try {
        if (!account.email || !account.password || !account.totpSecret) {
          throw new Error("Invalid format. Expected: email | password | 2fa_secret");
        }

        const { codeVerifier, codeChallenge, state } = generatePKCE();
        const redirectUri = "http://127.0.0.1:1455/auth/callback";
        const authUrl = buildAuthUrl(redirectUri, state, codeChallenge);
        const callbackPromise = waitForCallbackCode();

        context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(authUrl, { waitUntil: "domcontentloaded", timeout: WAIT_MEDIUM });

        const emailOk = await fillFirst(
          page,
          [
            'input[type="email"]',
            'input[autocomplete="username"]',
            'input[name*="email" i]',
            'input[id*="email" i]',
          ],
          account.email
        );
        if (!emailOk) throw new Error("Email input not found");
        await clickAny(page, ["continue", "next", "submit", "sign in"]);

        await page.waitForTimeout(800);
        const passOk = await fillFirst(
          page,
          ['input[type="password"]', 'input[name*="password" i]', 'input[id*="password" i]'],
          account.password
        );
        if (!passOk) throw new Error("Password input not found");
        await clickAny(page, ["continue", "next", "log in", "sign in", "submit"]);

        await page.waitForTimeout(1200);
        const otp = authenticator.generate(normalizeSecret(account.totpSecret));
        const otpOk = await fillFirst(
          page,
          [
            'input[autocomplete="one-time-code"]',
            'input[name*="otp" i]',
            'input[name*="code" i]',
            'input[inputmode="numeric"]',
          ],
          otp
        );
        if (otpOk) {
          await clickAny(page, ["continue", "verify", "submit", "next"]);
        }

        const callback = await callbackPromise;
        if (callback.error) {
          throw new Error(callback.error_description || callback.error);
        }
        if (!callback.code) {
          throw new Error("No authorization code received");
        }

        const tokens = await exchangeToken({
          code: callback.code,
          codeVerifier,
          redirectUri,
        });

        const info = extractCodexAccountInfo(tokens.id_token);
        await createProviderConnection({
          provider: "codex",
          authType: "oauth",
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          expiresAt: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : null,
          email: info.email || account.email,
          providerSpecificData: {
            chatgptAccountId: info.chatgptAccountId,
            chatgptPlanType: info.chatgptPlanType,
          },
          testStatus: "active",
        });

        item.ok = true;
        item.message = "Connected";
      } catch (error) {
        item.ok = false;
        item.message = error?.message || "Unknown error";
      } finally {
        if (context) await context.close();
        results.push(item);
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}
