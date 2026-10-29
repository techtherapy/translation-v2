/* Deployment configuration is code-reviewed. Never accept a URL from the sidebar. */
var BITS_BASE_URL = "https://translation-production-188f.up.railway.app";
var BITS_ALLOWED_BASE_URLS = [
  "https://translation-production-188f.up.railway.app",
];

function tokenClaims_(token) {
  try {
    var parts = token.split(".");
    if (parts.length !== 3) return {};
    var claims = JSON.parse(
      Utilities.newBlob(
        Utilities.base64DecodeWebSafe(parts[1]),
      ).getDataAsString(),
    );
    return claims && typeof claims === "object" ? claims : {};
  } catch (_error) {
    return {};
  }
}
function tokenExpiry_(token) {
  var claims = tokenClaims_(token);
  return typeof claims.exp === "number" ? claims.exp * 1000 : 0;
}
function expireSession_() {
  var properties = PropertiesService.getUserProperties();
  var claims = tokenClaims_(properties.getProperty("bits.jwt"));
  if (typeof claims.sub === "string" && claims.sub)
    properties.setProperty("bits.owner", claims.sub);
  properties.deleteProperty("bits.jwt");
}

function userToken_() {
  var token = PropertiesService.getUserProperties().getProperty("bits.jwt");
  if (!token || tokenExpiry_(token) <= Date.now()) {
    expireSession_();
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
    expireSession_();
    throw new Error("Sign in to BITS again; your session was rejected.");
  }
  // Do not reflect provider responses or transport errors: they may contain secrets.
  if (status < 200 || status >= 300) {
    var message =
      "BITS request failed (" + status + "). Retry or ask the maintainer.";
    if (status === 403)
      message = "Your BITS account cannot perform this review action.";
    if (status === 404)
      message =
        "Review unavailable: check feature access and project ownership.";
    if (status === 409)
      message =
        "The review checkpoint conflicts with this action. Refresh; example findings require the supplied chapter.";
    if (status === 422)
      message =
        "BITS rejected this request. Check the model and limits, then start again.";
    var error = new Error(message);
    error.requestRejected =
      [400, 403, 404, 405, 409, 422, 429].indexOf(status) >= 0;
    throw error;
  }
  try {
    return JSON.parse(response.getContentText());
  } catch (_error) {
    throw new Error("BITS returned an unreadable response.");
  }
}

function signIn(username, password) {
  expireSession_();
  var response = apiRequest_(
    "/api/auth/login",
    "post",
    { username: username, password: password },
    true,
  );
  var token = response.access_token;
  var owner = tokenClaims_(token).sub;
  if (
    typeof token !== "string" ||
    tokenExpiry_(token) <= Date.now() ||
    typeof owner !== "string" ||
    !owner
  )
    throw new Error("BITS did not return an expiring session.");
  var properties = PropertiesService.getUserProperties();
  // Resume private evidence only after the backend authenticates the same owner.
  if (properties.getProperty("bits.owner") !== owner) signOut();
  properties.setProperty("bits.owner", owner);
  properties.setProperty("bits.jwt", token);
  return { signedIn: true };
}

function signOut() {
  var properties = PropertiesService.getUserProperties();
  Object.keys(properties.getProperties())
    .filter(function (key) {
      return key.indexOf("bits.") === 0;
    })
    .forEach(function (key) {
      properties.deleteProperty(key);
    });
  return { signedIn: false };
}

function retryReviewRun_(binding) {
  return apiRequest_(
    "/api/docs-review/projects/" +
      binding.projectId +
      "/runs/" +
      binding.runId +
      "/retry",
    "post",
  );
}

function lessonRequest_(binding, suffix, method, payload) {
  return apiRequest_(
    projectPath_(binding) + "/lessons" + suffix,
    method,
    payload,
  );
}
function experimentRequest_(binding, suffix, method, payload) {
  return apiRequest_(
    projectPath_(binding) + "/experiments" + suffix,
    method,
    payload,
  );
}
