//
// Copyright 2013 Telefónica I+D
// All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may
// not use this file except in compliance with the License. You may obtain
// a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations
// under the License.
//


'use strict';


var nagios = require('./common/nagios');


// Nagios Exchange plugin "check_mem.sh" probe-specific parser
// References: http://exchange.nagios.org/directory/Plugins/System-Metrics/Memory/check_mem-2Esh/details
//
// Context attributes to be calculated:
//     usedMemPct = percentage of memory used
//
// Sample data: "Memory: OK Total: 1877 MB - Used: 369 MB - 19% used|TOTAL=1969020928;;;; USED=386584576;;;; CACHE=999440384;;;; BUFFER=201584640;;;;"
//                                   ^              ^        ^                 ^                   ^                   ^                    ^
//     Total memory (with units) ----+              |        |                 |                   |                   |                    |
//     Used memory (with units) --------------------+        |                 |                   |                   |                    |
//     Used memory (percentage) -----------------------------+                 |                   |                   |                    |
//     ====================                                                    |                   |                   |                    |
//     Total memory (bytes) ---------------------------------------------------+                   |                   |                    |
//     Used memory (bytes) ------------------------------------------------------------------------+                   |                    |
//     Cache memory (bytes) -------------------------------------------------------------------------------------------+                    |
//     Buffers memory (bytes) --------------------------------------------------------------------------------------------------------------+


var parser = Object.create(nagios.parser);
parser.getContextAttrs = function(multilineData, multilinePerfData) {
    var data  = multilineData.split('\n')[0];   // only consider first line of data, discard perfData
    var attrs = { usedMemPct: NaN };

    var items = data.split('-');
    if (items[2]) {
        attrs.usedMemPct = parseFloat(items[2].split('%')[0]);
    }

    if (isNaN(attrs.usedMemPct)) {
        throw new Error('No valid memory data found');
    }

    return attrs;
};


exports.parser = parser;
