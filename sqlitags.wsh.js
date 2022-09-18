// 本文件编码为 UTF-16LE
// 为方便管理进程，调用文件为:
//   cscript sqlitags.wsh.js datetime subcmd
// subcmd:
//   stop 停止
//   restart 重启
//   其它值 保持上一进程，没有则新建

var period = 60000;
var DBF = "D:/config/wincc.db";
var CONF = "D:/config/config.ini";

var conn_str = "Driver={SQLite3 ODBC Driver};Database=@FSPEC@;" // StepAPI=;Timeout=
  .replace("@FSPEC@", DBF);
var HMIService = WScript.CreateObject("CCHMIRuntime.HMIRuntime");
var conn = new ActiveXObject("ADODB.Connection");
var sSQL_create_table = "CREATE TABLE tags (time TIMESTAMP NOT NULL, name TEXT NOT NULL, value REAL, PRIMARY KEY (time, name))"
var sSQL_modi_record = "INSERT OR IGNORE INTO tags VALUES (timestamp, 'name', value);";
var DT
var tags_1N = [];
var tags_10N = [];
var tags_30N = [];
var tags_1H = [];
var tags_2HO = [];
var tags_2HE = [];
var tags_12H = [];
var tags_1D = [];
var tags_1M = [];
var TagsCache = {};

String.prototype.trim = function () {
  return this.replace(/^\s*|\s*$/g, '');
}
function killtask(PID) {
  WScript.CreateObject("WScript.Shell").Run("taskkill /F /PID " + PID, 0, true);
}

function get_service() {
  var strComputer = ".";
  var serivename = "root\\cimv2";
  var objLocator = new ActiveXObject("WbemScripting.SWbemLocator");
  return objLocator.ConnectServer(strComputer, serivename);
}

function get_start(cmd, date) {
  cmd = cmd == "stop" || cmd == "restart" || cmd == "list" ? cmd : "start";
  var service = get_service();
  var colItems = service.ExecQuery(
    "SELECT * FROM Win32_Process WHERE Name = 'cscript.exe' OR Name = 'wscript.exe'",
    null,
    48
  );
  var prev_procs = [];
  var exists_prev_proc = false;
  for (var iter = new Enumerator(colItems); !iter.atEnd(); iter.moveNext()) {
    var objItem = iter.item();
    var cmdline = objItem.CommandLine;
    if (cmdline.indexOf("sqlitags") == -1) continue;
    if (cmdline.indexOf(date) == -1) {
      exists_prev_proc = true;
      prev_procs.push(objItem.ProcessId);
      if (cmd == "restart" || cmd == "stop") killtask(objItem.ProcessId);
    }
  }
  if (cmd == "restart") {
    return true;
  }
  if (cmd == "start" && !exists_prev_proc) {
    return true;
  }
  if (cmd == "list") {
    WScript.Echo('已有' + prev_procs.length + '个进程: ' + prev_procs.join(', '));
  }
  return false;
}

// get timezone on startup
function getTimeZone() {
  var colItems = get_service().ExecQuery("Select * from Win32_OperatingSystem", null, 48);
  return new Enumerator(colItems).item().CurrentTimeZone * 60;
}

function setDT(dt_str) {
  var dt = (dt_str == null) ? new Date() : new Date(dt_str.replace('-', '/'));
  dt.setSeconds(0);
  dt.setMilliseconds(0);
  DT = {
    obj: dt,
    Y: dt.getFullYear(),
    M: dt.getMonth() + 1,
    D: dt.getDate(),
    H: dt.getHours(),
    N: dt.getMinutes(),
    S: 0,
    W: dt.getDay(),
    timestamp: dt.valueOf() / 1000
  };
  // WScript.Echo(DT.timestamp, DT.Y, DT.M, DT.D, DT.H, DT.N, DT.S, DT.W);
}

function parse_line(lineText) {
  var pair, tagdesc;
  var pair = lineText.split("=", 2);
  if (pair.length == 2) {
    tagdesc = pair[1].trim().split(",", 3);
    if (tagdesc.length == 3) {
      var item = {
        "name": pair[0].trim(),
        "tagname": tagdesc[0],
        "valid": tagdesc[1]
      }
      switch (tagdesc[2]) {
        case "1minute":
          tags_1N.push(item);
          break;
        case "10minutes":
          tags_10N.push(item);
          break;
        case "30minutes":
          tags_30N.push(item);
          break;
        case "2hoursO":
          tags_2HO.push(item);
          break;
        case "2hoursE":
          tags_2HE.push(item);
          break;
        case "12hours":
          tags_12H.push(item);
          break;
        case "1day":
          tags_1D.push(item);
          break;
        case "1month":
          tags_1M.push(item);
          break;
        default:
          tags_1H.push(item);
      }
    }
  }
}

function init() {
  var fso = new ActiveXObject("Scripting.FileSystemObject");
  if (!fso.FileExists(DBF)) {
    // 'if possiable create file
    fso.CreateTextFile(DBF, true);
    try {
      conn.Open(conn_str);
      WScript.Echo("connected to", DBF);
      conn.Execute(sSQL_create_table);
      WScript.Echo("table tags created");
      conn.Close();
    } catch (error) {
      // error.msg
      WScript.Echo("can't open DB:", error.description);
    }
  }

  if (!fso.FileExists(CONF)) {
    WScript.Echo("configure file", CONF, " not exists!");
    return;
  }
  var stm = WScript.CreateObject("ADODB.Stream");
  stm.Type = 2; // adTypeText
  stm.mode = 3; // adModeRead
  stm.charset = "utf-8";
  stm.Open();
  stm.loadfromfile(CONF);
  var section;
  while (!stm.EOS) {
    var strLine = stm.ReadText(-2).trim();
    if (strLine != "") {
      if (strLine.substring(0, 1) == ";" || strLine.substring(strLine.length - 1) == "#") {
        var comment = strLine.substring(1).trim();
      } else if (strLine.substring(0, 1) == "[" && strLine.substring(strLine.length - 1) == "]") {
        section = strLine.substring(1, strLine.length - 1).trim();
      } else if (section == "tags") {
        parse_line(strLine);
      }
    }
  }
  stm.Close();
  stm = null;
}

function getWinCCTag(tagname) {
  var tag = TagsCache[tagname];
  if (tag) return tag; // from cache
  try {
    tag = HMIService.Tags(tagname);
    tag.Read();
    if (28 == tag.QualityCode) { // check tag existence
      tag = null;
    } else {
      TagsCache[tagname] = tag;
    }
    return tag;
  } catch (error) {
    WScript.Echo("can't open HMIRuntime");
  }
}

function saveTag(conn, name, tagname, validname) {
  var tag = getWinCCTag(tagname);
  var tagvalue;
  if (tag != null) {
    tagvalue = tag.read();
  } else { // tag does not exist
    tagvalue = null;
  }
  var valid = null;
  if (validname !== '') {
    valid = getWinCCTag(validname);
    if (valid && valid.read() != 1) {// valid does not exist or it's value is false
      tagvalue = null;
    }
  }
  if (tag === null) return null;
  var sSQL = sSQL_modi_record
    .replace("timestamp", DT.timestamp)
    .replace("name", name)
    .replace("value", tagvalue);
  try {
    conn.Execute(sSQL);
    WScript.Echo("save: ", DT.timestamp, name, tagvalue);
    return true;
  } catch (error) {
    WScript.Echo("can't save:", error.description);
    return false;
  }
}

// archive tags to sqlite
function saveTags(tags) {
  try {
    conn.Open(conn_str);
    for (var i = 0; i < tags.length; i++) {
      var item = tags[i];
      saveTag(conn, item.name, item.tagname, item.valid);
    }
  } catch (error) {
    WScript.Echo("can't open DB: ", error.Description);
  }
  conn.Close();
}


// 取得根据子命令和ID
var argsNamed = WScript.Arguments.Named;
var argsUnnamed = WScript.Arguments.Unnamed;
var start = get_start(argsUnnamed.Item(0), argsNamed.Item("date"));

init();

while (start) {
  var o = new Date().valueOf() % period;
  WScript.Sleep(period - o);
  var now = new Date();
  o = now.valueOf() % period;
  if (o > period / 2) continue;
  // 以下定时处理
  setDT();
  // on 1minute
  saveTags(tags_1N);
  // on 10minutes
  if (DT.N % 10 == 0) saveTags(tags_10N);
  // on 10minutes
  if (DT.N == 30) saveTags(tags_30N);
  if (DT.N == 0) {
    // on 10minutes
    saveTags(tags_30N);
    // on 1hour
    saveTags(tags_1H);
    // on 2hour
    if (DT.H % 2 == 0) saveTags(tags_2HE);
    else saveTags(tags_2HO);
    // on 12hour
    if (DT.H == 12) saveTags(tags_12H);
    if (DT.H == 0) {
      // on 12hour
      saveTags(tags_12H);
      // on 1day
      saveTags(tags_1D);
      // on 1month
      if (DT.D == 1) saveTags(tags_1M);
    }
  }
};
