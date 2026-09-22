/* Deployment configuration is code-reviewed. Never accept a URL from the sidebar. */
var BITS_BASE_URL = "https://translation-production-c3ad.up.railway.app";
var BITS_ALLOWED_BASE_URLS = [
  "https://translation-production-c3ad.up.railway.app",
];

function tokenExpiry_(token) {
  try {
    var parts = token.split(".");
    if (parts.length !== 3) return 0;
    var claims = JSON.parse(
      Utilities.newBlob(
        Utilities.base64DecodeWebSafe(parts[1]),
      ).getDataAsString(),
    );
    return typeof claims.exp === "number" ? claims.exp * 1000 : 0;
  } catch (_error) {
    return 0;
  }
}

function userToken_() {
  var token = PropertiesService.getUserProperties().getProperty("bits.jwt");
  if (!token || tokenExpiry_(token) <= Date.now()) {
    signOut();
    throw new Error(
      "Sign in to BITS again; your session is missing or expired.",
    );
  }
  return token;
}

function apiRequest_(path, method, payload, loginRequest) {
  if (!/^\/api\/(?:auth\/login|docs-review(?:\/[A-Za-z0-9_-]+)*)$/.test(path)) {
    throw new Error("Unsupported BITS request path.");
  }
  if (
    BITS_ALLOWED_BASE_URLS.indexOf(BITS_BASE_URL) < 0 ||
    !/^https:\/\/[a-z0-9.-]+$/.test(BITS_BASE_URL)
  ) {
    throw new Error(
      "A maintainer must configure an allowed HTTPS BITS deployment.",
    );
  }
  var options = {
    method: method,
    muteHttpExceptions: true,
    followRedirects: false,
    validateHttpsCertificates: true,
  };
  if (loginRequest) {
    options.payload = payload; // OAuth2 form fields; password exists only for this call.
  } else {
    options.headers = { Authorization: "Bearer " + userToken_() };
    if (payload !== undefined) {
      options.contentType = "application/json";
      options.payload = JSON.stringify(payload);
    }
  }
  var response;
  try {
    response = UrlFetchApp.fetch(BITS_BASE_URL + path, options);
  } catch (_error) {
    throw new Error("BITS could not be reached. Retry the action.");
  }
  var status = response.getResponseCode();
  if (status === 401) {
    signOut();
    throw new Error("Sign in to BITS again; your session was rejected.");
  }
  // Do not reflect provider responses or transport errors: they may contain secrets.
  if (status < 200 || status >= 300) {
    if (status === 403)
      throw new Error("Your BITS account cannot perform this review action.");
    if (status === 404)
      throw new Error(
        "Review unavailable: check feature access and project ownership.",
      );
    if (status === 409)
      throw new Error(
        "The review checkpoint conflicts with this action. Refresh; example findings require the supplied chapter.",
      );
    throw new Error(
      "BITS request failed (" + status + "). Retry or ask the maintainer.",
    );
  }
  try {
    return JSON.parse(response.getContentText());
  } catch (_error) {
    throw new Error("BITS returned an unreadable response.");
  }
}

function signIn(username, password) {
  signOut();
  var response = apiRequest_(
    "/api/auth/login",
    "post",
    { username: username, password: password },
    true,
  );
  var token = response.access_token;
  if (typeof token !== "string" || tokenExpiry_(token) <= Date.now())
    throw new Error("BITS did not return an expiring session.");
  PropertiesService.getUserProperties().setProperty("bits.jwt", token);
  return { signedIn: true };
}

function signOut() {
  var properties = PropertiesService.getUserProperties();
  ["bits.jwt", "bits.binding", "bits.pending"].forEach(function (key) {
    properties.deleteProperty(key);
  });
  return { signedIn: false };
}
