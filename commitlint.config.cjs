module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-empty": [2, "never"],
    "scope-enum": [
      2,
      "always",
      [
        "extension", // manifest and changes across the whole extension
        "stories", // the story camera and editor, and sharing posts
        "audience", // close friends and other changes to the share request
        "mobile", // phone tabs presenting as mobile Safari
        "hide", // hiding the home feed and Reels
        "photos", // Google Photos picker
        "popup", // settings popup
        "firefox",
        "chrome",
        "icons",
        "build",
        "release",
        "readme",
        "docs",
        "tests",
        "tooling",
        "ci",
        "deps",
        "deps-dev", // Dependabot's updates to development dependencies
      ],
    ],
  },
};
