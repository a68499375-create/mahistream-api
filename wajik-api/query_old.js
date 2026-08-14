import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('mahistream.sqlite');

db.all("SELECT * FROM history WHERE user_id = '51378763';", [], (err, history) => {
  if (err) console.error(err);
  console.log('OLD HISTORY:', history);
  db.close();
});
