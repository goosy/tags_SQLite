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

var conn_str = "Driver={SQLite3 ODBC Driver};Database=@FSPEC@;StepAPI=;Timeout=".replace("@FSPEC@", DBF)
var conn = WScript.CreateObject("ADODB.Connection")
var timestamp, timezone, DT
var tags_1N = [];
var tags_10N = [];
var tags_30N = [];
var tags_1H = [];
var tags_2HO = [];
var tags_2HE = [];
var tags_12H = [];
var tags_1D = [];
var tags_1M = [];
var WinCCTags = {};

function killtask(PID) {
  WScript.CreateObject("wscript.shell").Run("taskkill /F /PID " + PID, 0, true);
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
        case "10minute":
          tags_10N.push(item);
          break;
        case "30minute":
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
  var fso = new ActiveXObject("Scripting.FileSystemObject")
  var sSQL = "CREATE TABLE tags (time TIMESTAMP NOT NULL, name TEXT NOT NULL, value REAL, PRIMARY KEY (time, name))"

  if (!fso.FileExists(DBF)) {
    // 'if possiable create file
    fso.CreateTextFile(DBF, true);
    try {
      conn.Open(conn_str);
      WScript.Echo("connected to " & DBF);
      conn.Execute(sSQL);
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
  var stm = new ActiveXObject("Adodb.Stream");
  stm.Type = 2; // adTypeText
  stm.mode = 3; // adModeRead
  stm.charset = "utf-8";
  stm.Open();
  stm.loadfromfile(CONF);
  var section, comment;
  while (!stm.EOS) {
    var strLine = stm.ReadText(-2).trim();
    if (strLine != "") {
      if (strLine[0] == ";" || strLine[0] == "#") {
        comment = strLine.substring(1).trim();
      } else if (strLine[0] == "[" && strLine[strLine.length - 1] == "]") {
        section = strLine.substring(1, strLine.length - 2).trim()
      } else if (section == "tags") {
        parse_line(strLine)
      }
    }
  }
  stm.Close
  Set stm = Nothing

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
  // );
};
