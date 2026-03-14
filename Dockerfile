# OpenShift-friendly: runs as non-root, listens on 8080
FROM nginxinc/nginx-unprivileged:1.27-alpine

USER root

# Replace default config with our custom one (port 8080, try_files for SPA-style routing)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy static assets
COPY run.html game.js style.css /usr/share/nginx/html/
COPY data/ /usr/share/nginx/html/data/

# Ensure nginx can read the files (image runs as nginx, UID 101)
RUN chown -R nginx:nginx /usr/share/nginx/html

USER nginx

EXPOSE 8080

# No CMD needed – nginx-unprivileged image starts nginx by default
