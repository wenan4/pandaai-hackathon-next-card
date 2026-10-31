const params = new URLSearchParams(window.location.search);

if (params.get("legacy") === "1") {
  void import("./legacy");
} else {
  void import("./adventure/ui");
}
