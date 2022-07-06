FROM node:16
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --no-audit
COPY . .
EXPOSE 3000
CMD [ "npm", "start" ]
