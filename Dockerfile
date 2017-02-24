FROM gw000/keras:latest

MAINTAINER Wei OUYANG <oeway007@gmail.com>

RUN apt-get update -qq \
        && apt-get install --no-install-recommends -y \
        curl

RUN groupadd --gid 1000 node \
  && useradd --uid 1000 --gid node --shell /bin/bash --create-home node


ENV NPM_CONFIG_LOGLEVEL info
ENV NODE_VERSION 7.6.0

RUN curl -SLO "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" \
  && tar -xJf "node-v$NODE_VERSION-linux-x64.tar.xz" -C /usr/local --strip-components=1 \
  && rm "node-v$NODE_VERSION-linux-x64.tar.xz" \
  && ln -s /usr/local/bin/node /usr/local/bin/nodejs

RUN set -x \
        && git clone https://github.com/oeway/AILabNode.git /src/AILabNode 

WORKDIR /src/AILabNode

RUN set -x \
	&& cd /src/AILabNode \
	&& npm install

ENTRYPOINT [ "node", "index.js"]

