# Stage 1: build Tailwind CSS from the actual classes used in our HTML/JS.
# Ini hasilkan CSS minimal (cuma class yang dipakai) - tiada CDN dependency.
FROM node:20-alpine AS css-builder
WORKDIR /build
COPY public/ ./public/
COPY tailwind.config.js ./
COPY tailwind.input.css ./
RUN npm install -D tailwindcss@3.4.17 && \
    npx tailwindcss -c tailwind.config.js -i tailwind.input.css -o public/tailwind.css --minify

# Stage 2: serve static files via nginx
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=css-builder /build/public/ /usr/share/nginx/html/
EXPOSE 80
