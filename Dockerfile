# I build the pickup worker that subscribes to the SQS Queue.
FROM node:16-alpine
WORKDIR /usr/src/app

# Such is monorepo lyfe.
COPY package*.json ./
COPY pickup/package.json ./pickup/package.json
RUN npm ci -w pickup --no-audit
COPY . .
CMD [ "npm", "start", "-w", "pickup" ]