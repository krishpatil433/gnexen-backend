FROM node:18-alpine

WORKDIR /usr/src/app

# Pehle package.json copy karo
COPY package.json ./

# Phir install karo
RUN npm install

# Baaki files copy karo
COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
