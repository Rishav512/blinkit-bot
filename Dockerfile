FROM node:20-bookworm

# Set Indian Standard Timezone (IST)
ENV TZ=Asia/Kolkata

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Install Playwright browsers and OS dependencies
RUN npx playwright install --with-deps chromium

# Copy the rest of the application code
COPY . .

# Expose the port used by the dummy web server
EXPOSE 3000

# Start the bot
CMD ["npm", "start"]
