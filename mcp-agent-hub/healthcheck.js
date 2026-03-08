import http from "node:http";

const port = process.env.PORT || 3100;

const req = http.get(`http://localhost:${port}/health`, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});

req.on("error", () => process.exit(1));
req.setTimeout(3000, () => {
  req.destroy();
  process.exit(1);
});
