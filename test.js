<!DOCTYPE html>
<html lang=en>
<body>
  <h1>hi</h1>
  <?
  require('util');
  write(JSON.stringify(global, null, 2));
  write('hello i am a server');
  ?>
</body>
</html>