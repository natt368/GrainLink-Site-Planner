import express from "express";
import path from "path";
import { exec } from "child_process";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for parsing JSON
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Get current git status
  app.get("/api/github/status", (req, res) => {
    exec("git status --porcelain", (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
      const lines = stdout.trim().split("\n").filter(Boolean);
      res.json({
        success: true,
        hasChanges: lines.length > 0,
        changes: lines,
      });
    });
  });

  // Push local changes to GitHub
  app.post("/api/github/push", (req, res) => {
    const { commitMessage } = req.body;
    const message = commitMessage ? commitMessage.replace(/"/g, '\\"') : "Sync from AI Studio Manual Button";

    // Run sync.sh helper script to commit and push
    exec(`./sync.sh "${message}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error running sync.sh: ${error.message}`);
        return res.status(500).json({
          success: false,
          error: error.message,
          stdout,
          stderr,
        });
      }
      console.log(`sync.sh output: ${stdout}`);
      return res.json({
        success: true,
        stdout,
        stderr,
      });
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
