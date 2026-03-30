//+------------------------------------------------------------------+
//|  Tradekashi EA v2 — MQL5                                       |
//|  Listens for HTTP orders from the Tradekashi relay server      |
//|  Install in MQL5/Experts/ and attach to any chart               |
//+------------------------------------------------------------------+
#property copyright "Tradekashi"
#property version   "2.10"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

// ─── Input parameters ──────────────────────────────────────────────
input string   ApiKey        = "YOUR_API_KEY";   // Tradekashi API key
input string   RelayHost     = "mt5-relay.signalbridge.io"; // Relay host
input int      MagicNumber   = 88001;            // EA magic number
input bool     EnableLogging = true;             // Log all signals
input int      Slippage      = 10;               // Max slippage (points)
input bool     DemoMode      = false;            // Dry-run (no real orders)
input int      PollIntervalMS= 500;              // Poll interval ms

CTrade trade;
CPositionInfo posInfo;

// ─── Init ──────────────────────────────────────────────────────────
int OnInit() {
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(Slippage);
   Print("Tradekashi EA started. Relay: ", RelayHost, " Magic: ", MagicNumber);
   EventSetMillisecondTimer(PollIntervalMS);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
   EventKillTimer();
   Print("Tradekashi EA stopped.");
}

// ─── Timer: poll relay for pending orders ─────────────────────────
void OnTimer() {
   string url     = "https://" + RelayHost + "/pending?magic=" + IntegerToString(MagicNumber);
   string headers = "X-API-Key: " + ApiKey + "\r\nContent-Type: application/json";
   char   postData[], result[];
   string resultHeaders;

   int res = WebRequest("GET", url, headers, 5000, postData, result, resultHeaders);
   if (res == -1) return; // no pending orders or network issue

   string json = CharArrayToString(result);
   if (StringLen(json) < 10) return;

   // Parse JSON array of orders (simple parser for demo)
   ParseAndExecuteOrders(json);
}

// ─── Parse incoming JSON order array ──────────────────────────────
void ParseAndExecuteOrders(string json) {
   // Find each order object between { }
   int pos = 0;
   while (true) {
      int start = StringFind(json, "{", pos);
      if (start < 0) break;
      int end = StringFind(json, "}", start);
      if (end < 0) break;

      string obj = StringSubstr(json, start, end - start + 1);
      ProcessOrder(obj);
      pos = end + 1;
   }
}

string ExtractField(string json, string key) {
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if (pos < 0) return "";
   int vStart = pos + StringLen(search);
   // skip whitespace and quotes
   while (vStart < StringLen(json) && (json[vStart] == ' ' || json[vStart] == '"')) vStart++;
   int vEnd = vStart;
   while (vEnd < StringLen(json) && json[vEnd] != '"' && json[vEnd] != ',' && json[vEnd] != '}') vEnd++;
   return StringSubstr(json, vStart, vEnd - vStart);
}

// ─── Execute a single order ────────────────────────────────────────
void ProcessOrder(string obj) {
   string orderId    = ExtractField(obj, "orderId");
   string symbolStr  = ExtractField(obj, "symbol");
   string typeStr    = ExtractField(obj, "type");    // "0" BUY, "1" SELL
   string lotsStr    = ExtractField(obj, "lots");
   string slStr      = ExtractField(obj, "sl");
   string tpStr      = ExtractField(obj, "tp");
   string commentStr = ExtractField(obj, "comment");

   if (symbolStr == "" || lotsStr == "") return;

   double lots = StringToDouble(lotsStr);
   double sl   = StringToDouble(slStr);
   double tp   = StringToDouble(tpStr);
   int    type = (int)StringToInteger(typeStr);

   if (EnableLogging)
      Print("Tradekashi: ", (type==0?"BUY":"SELL"), " ", symbolStr, " lots=", lots,
            " SL=", sl, " TP=", tp, " [", orderId, "]");

   if (DemoMode) {
      Print("DemoMode: order NOT executed.");
      AckOrder(orderId, "simulated");
      return;
   }

   bool ok = false;
   if (type == 0)  // BUY
      ok = trade.Buy(lots, symbolStr, 0, sl, tp, commentStr);
   else             // SELL
      ok = trade.Sell(lots, symbolStr, 0, sl, tp, commentStr);

   if (ok) {
      Print("Order placed OK: ", trade.ResultOrder());
      AckOrder(orderId, "ok");
   } else {
      Print("Order FAILED: ", trade.ResultRetcode(), " ", trade.ResultComment());
      AckOrder(orderId, "error_" + IntegerToString(trade.ResultRetcode()));
   }
}

// ─── Acknowledge processed order back to relay ────────────────────
void AckOrder(string orderId, string status) {
   string url     = "https://" + RelayHost + "/ack";
   string headers = "X-API-Key: " + ApiKey + "\r\nContent-Type: application/json";
   string payload = "{\"orderId\":\"" + orderId + "\",\"status\":\"" + status + "\"}";
   char   postData[], result[];
   string resultHeaders;
   ArrayResize(postData, StringLen(payload));
   StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   WebRequest("POST", url, headers, 5000, postData, result, resultHeaders);
}

void OnTick() {}
//+------------------------------------------------------------------+
