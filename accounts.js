/* 账号数据库 · 由《用户账号信息.xlsx》自动生成，请勿手改 */
const ACCOUNTS = {
  "s": [
    {
      "id": "20260101",
      "name": "李小时",
      "pw": "123456",
      "group": "学生",
      "cls": "2026级（11）班",
      "avatar": "avatars/20260101.png"
    },
    {
      "id": "20260102",
      "name": "张三疯",
      "pw": "123456",
      "group": "学生",
      "cls": "2026级（1）班",
      "avatar": "avatars/20260102.png"
    }
  ],
  "t": [
    {
      "id": "ls70001",
      "name": "王老师",
      "pw": "123456",
      "group": "老师",
      "cls": "2026级（11）班",
      "avatar": "avatars/ls70001.png"
    }
  ],
  "a": [
    {
      "id": "admin",
      "name": "管理员",
      "pw": "admin",
      "group": "管理员",
      "cls": "",
      "avatar": ""
    }
  ]
};
const ROLE_FIELD = { s:"学号", t:"工号", a:"账号" };
const ROLE_PLACEHOLDER = { s:"例如：20260101", t:"例如：ls70001", a:"例如：admin" };
