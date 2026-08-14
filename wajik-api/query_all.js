import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('mahistream.sqlite');

db.all("SELECT * FROM history;", [], (err, history) => {
  if (err) console.error(err);
  console.log('ALL HISTORY:', history);
  db.close();
});
