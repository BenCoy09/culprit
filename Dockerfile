FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git config --global user.email "web@culprit.local" && git config --global user.name "culprit-web"
WORKDIR /app
COPY . .
RUN chmod +x demo/fake-kane.mjs
ENV PORT=8080
EXPOSE 8080
CMD ["node","web.mjs"]
