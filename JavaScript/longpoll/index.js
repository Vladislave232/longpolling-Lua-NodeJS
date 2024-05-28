const fastify = require('fastify')({ logger: false, connectionTimeout: 60000 });
const formbody = require('@fastify/formbody');

fastify.register(formbody);

class LongPoll {
  constructor(port = 13921, routePath = '/longpoll', tokens = []) {
    this.port = port;
    this.routePath = routePath;
    this.tokens = tokens;
    this.usersList = tokens.map(({ nick, token }) => ({
      nick,
      token,
      status: true,
      clientLost: false,
      messages: [],
      res: null,
    }));
  }

  initialize(callback) {
    fastify.get(this.routePath, async (req, reply) => {
      if (!this.isLocalhost(req.ip)) {
        return reply.code(403).send('Access denied');
      }

      const token = req.query.token;
      const userNick = getUser(this.tokens, token);
      if (!userNick) {
        return reply.code(403).send('Invalid Token');
      }

      const user = this.usersList.find(user => user.nick === userNick);
      if (!user) {
        return reply.code(403).send('Invalid User');
      }

      if (user.messages.length > 0) {
        const messages = [...user.messages];
        user.messages = [];
        return reply.send(messages);
      }

      reply.hijack();
      user.res = reply.raw;

      setTimeout(() => {
        if (user.res) {
          user.res.end(JSON.stringify([]));
          user.res = null;
        }
      }, 30000); // Wait for a maximum of 30 seconds
    });

    fastify.post(this.routePath, async (req, reply) => {
      if (!this.isLocalhost(req.ip)) {
        return reply.code(403).send('Access denied');
      }

      const token = req.query.token;
      const userNick = getUser(this.tokens, token);
      if (!userNick) {
        return reply.code(400).send('Invalid Token');
      }

      const { type, data } = req.body;
      if (!type) {
        return reply.code(400).send('Invalid Type');
      }

      const user = this.usersList.find(u => u.nick === userNick);
      if (!user) {
        return reply.code(400).send('Invalid User');
      }

      switch (type) {
        case 'checkstatus':
          user.status = true;
          user.clientLost = false;
          break;
        case 'connect':
          this.handlerConnect(userNick);
          break;
        default:
          try {
            this.messageHandler({ object: data, nick: userNick });
          } catch (error) {
            console.error(error);
          }
      }
      return reply.code(200).send();
    });

    this.checkStatus();

    fastify.listen(this.port, '0.0.0.0', err => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      if (callback) callback();
    });
  }

  onMessage(handler) {
    this.messageHandler = handler;
  }

  sendLongPoll(name, longpollmessage) {
    const user = this.usersList.find(user => user.nick === name);
    if (user) {
      user.messages.push(longpollmessage);
      if (user.res) {
        user.res.end(JSON.stringify(user.messages));
        user.messages = [];
        user.res = null;
      }
    }
  }

  onLostClient(handler) {
    this.handlerLost = handler;
  }

  onConnectClient(handler) {
    this.handlerConnect = handler;
  }

  checkStatus() {
    setInterval(() => {
      this.usersList.forEach(user => {
        if (!user.messages.includes('checkstatus')) {
          user.messages.push('checkstatus');
        }
        if (user.status === false && !user.clientLost) {
          this.handlerLost(user.nick);
          user.clientLost = true;
        }
        user.status = false;
      });
    }, 3000);
  }

  isLocalhost(ip) {
    return ip === '127.0.0.1' || ip === '::1';
  }
}

function getUser(tokens, token) {
  const user = tokens.find(user => user.token === token);
  return user ? user.nick : false;
}

module.exports = LongPoll;
