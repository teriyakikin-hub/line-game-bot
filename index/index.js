const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);
const app = express();

const userSessions = {};

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const text = event.message.text.trim();

  // 1. 一発で募集するパターン（例: /募集 フォートナイト 21:00 3）
  if (text.startsWith('/募集 ') || text.startsWith('募集 ')) {
    const args = text.split(/\s+/).slice(1);
    if (args.length >= 3) {
      const game = args[0];
      const time = args[1];
      const members = args[2];

      const flexMessage = createRecruitmentCard(game, time, members);
      return client.replyMessage(event.replyToken, flexMessage);
    }
  }

  // 2. 対話形式で募集を開始するパターン
  if (text === '募集' || text === '/募集') {
    userSessions[userId] = { step: 'GAME' };
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '🎮 どのゲームを募集しますか？以下のボタンから選ぶか、直接入力してね！',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: 'フォートナイト', text: 'フォートナイト' } },
          { type: 'action', action: { type: 'message', label: 'ロブロックス', text: 'ロブロックス' } },
          { type: 'action', action: { type: 'message', label: 'Among Us', text: 'Among Us' } },
          { type: 'action', action: { type: 'message', label: 'ブロスタ', text: 'ブロスタ' } },
          { type: 'action', action: { type: 'message', label: 'eFootball', text: 'eFootball' } },
          { type: 'action', action: { type: 'message', label: '💬 雑談', text: '雑談' } },
          { type: 'action', action: { type: 'message', label: '✨ その他', text: 'その他' } }
        ]
      }
    });
  }

  // 3. 順番に入力するフローの処理
  if (userSessions[userId]) {
    const session = userSessions[userId];

    if (session.step === 'GAME') {
      session.game = text;
      session.step = 'TIME';
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `【${text}】ですね！\n何時から始めますか？（例: 21:00、今から）`
      });
    }

    if (session.step === 'TIME') {
      session.time = text;
      session.step = 'MEMBERS';
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '募集人数を入力してください（例: 3人なら「3」、制限なしなら「なし」）'
      });
    }

    if (session.step === 'MEMBERS') {
      session.members = text;
      const recruitingData = { ...session };
      delete userSessions[userId];

      const flexMessage = createRecruitmentCard(recruitingData.game, recruitingData.time, recruitingData.members);
      return client.replyMessage(event.replyToken, flexMessage);
    }
  }

  return Promise.resolve(null);
}

// 募集カード（Flex Message）の生成
function createRecruitmentCard(game, time, members) {
  const memberText = (members === 'なし' || members === '無制限') ? '制限なし' : `${members.replace('人', '')}人`;

  return {
    type: 'flex',
    altText: `【募集】${game} (${time}〜)`,
    contents: {
      type: 'bubble',
      hero: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🎮 メンバー募集！',
            weight: 'bold',
            size: 'xl',
            color: '#ffffff',
            align: 'center'
          }
        ],
        backgroundColor: '#00B900',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: game,
            weight: 'bold',
            size: 'xxl',
            margin: 'md'
          },
          {
            type: 'separator',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  { type: 'text', text: '⏰ 開始時間', color: '#aaaaaa', size: 'sm', flex: 2 },
                  { type: 'text', text: time, wrap: true, color: '#666666', size: 'sm', flex: 4, weight: 'bold' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  { type: 'text', text: '👥 募集人数', color: '#aaaaaa', size: 'sm', flex: 2 },
                  { type: 'text', text: memberText, wrap: true, color: '#666666', size: 'sm', flex: 4, weight: 'bold' }
                ]
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: {
              type: 'message',
              label: '参加する！',
              text: '参加します！'
            },
            color: '#00B900'
          }
        ],
        flex: 0
      }
    }
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

