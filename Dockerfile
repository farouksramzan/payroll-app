# ── Stage 1: Build the React frontend ────────────────────────────────────────
FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production backend ───────────────────────────────────────────────
FROM node:20-slim AS production

# System deps required by Playwright/Chromium
RUN apt-get update && apt-get install -y \
      ca-certificates fonts-liberation wget gnupg \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 \
      libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libgtk-3-0 \
      libnspr4 libnss3 libx11-6 libxcb1 libxcomposite1 \
      libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend deps (production only)
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Install Playwright's Chromium into a fixed path
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium

# Copy backend source
COPY backend/ ./

# Copy built frontend into backend's public/ directory
COPY --from=frontend-build /frontend/dist ./public

# Ensure persistent-storage directories exist (Railway Volume mounts /data)
RUN mkdir -p /data /data/screenshots

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/payroll.db
ENV SCREENSHOTS_DIR=/data/screenshots

EXPOSE 3000
CMD ["node", "server.js"]
