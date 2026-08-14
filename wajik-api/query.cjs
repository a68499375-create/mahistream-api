const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('mahistream.sqlite');

db.all("SELECT name FROM sqlite_master WHERE type='table';", [], (err, tables) => {
  if (err) console.error(err);
  console.log('TABLES:', tables);
  
  db.all("SELECT * FROM history;", [], (err, history) => {
    if (err) console.error(err);
    console.log('HISTORY:', history);
    db.close();
  });
});
