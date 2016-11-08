/* ===================================================
 *  sensor.js - javascript decoder of oregon scientific
 *  and cresta weather sensors radio protocol messages
 * ---------------------------------------------------
 * The implementation is based on
 * Homey app to view Oregon Scientific sensor info in
 * Athom Homey code:
 * https://github.com/nattlip/com.jilles.oregon by
 * Jilles Miedema
 * ---------------------------------------------------
 * Copyright (c) 2016 Jilles Miedema
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR
 * ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 * ===================================================
 */
"use strict";

var oregonDataLayouts = {
    'TH1': {
        len: 7,
        data: {
            temperature: {start: 0, len: 3, div: 10},
            sign: {start: 3, len: 1},
            humidity: {start: 4, len: 2},
            unknown: {start: 6, len: 1}
        }
    },
    'T1': {
        len: 4,
        data: {
            temperature: {start: 0, len: 3, div: 10},
            sign: {start: 3, len: 1}
        }
    },
    'UV1': {
        len: 4,
        data: {
            uvindex: {start: 0, len: 2},
            unknown: {start: 2, len: 2}
        }
    },
    'UV2': {
        len: 5,
        data: {
            unknown: {start: 0, len: 3},
            uvindex: {start: 3, len: 2}
        }
    },
    'W1': {
        len: 9,
        data: {
            direction: {start: 0, len: 1, enc: 'bin'},
            unknown: {start: 1, len: 2},
            currentspeed: {start: 3, len: 3, div: 10},
            averagespeed: {start: 6, len: 3, div: 10}
        }
    },
    'R1': {
        len: 10,
        data: {
            rainrate: {start: 0, len: 4, div: 100},  // 0.01 inch/hr
            raintotal: {start: 4, len: 6, div: 1000} // 0.001 inch
        }
    },
    'R2': {
        len: 8,
        data: {
            rainrate: {start: 0, len: 4, div: 10},   // 0.1 mm/hr
            raintotal: {start: 4, len: 4, div: 10}  // 0.1 mm
        }
    },
    'THB': {
        len: 9, // 11 ?
        data: {
            temperature: {start: 0, len: 3, div: 10},
            sign: {start: 3, len: 1},
            humidity: {start: 4, len: 2},
            comfort: {
                start: 6, len: 1, map: {0: 'Normal', 4: 'Comfortable', 8: 'Dry', c: 'Wet'}
            },
            pressure: {start: 7, len: 2, add: 856}, // mbar
            forecast: {
                start: 9, len: 1, map: {2: 'Cloudy', 3: 'Rainy', 6: 'Partly cloudy', c: 'Sunny'}
            }
        }
    }
};

var oregonKnownSensors = {
    '1984': {name: 'WGR800', layout: 'W1'},
    '1994': {name: 'WGR800', layout: 'W1'},
    '1D20': {name: 'THGN123N/THGR122NX', layout: 'TH1'}, // example: 1D201D405520018732F
    '1A2D': {name: 'THGR228N/THGN132N/THGR918/THGR928/THGRN228/THGN500'},
    'E2CF': {name: 'THGR333/THGN228NX', layout: 'TH1'},   // deze is het // kleine in corona
    '1D30': {name: 'THGN500', layout: 'TH1'},
    '1A3D': {name: 'THGR918'},
    '2914': {name: 'PCR800', layout: 'R1'},
    '2A1D': {name: 'RGR918'},
    '2D10': {name: 'RGR968', layout: 'R2'},
    '3A0D': {name: 'STR918/WGR918'},
    '5A5D': {name: 'BTHR918'},
    '5D60': {name: 'BTHR968/BTHR 918N', layout: 'THB'},
    'C844': {name: 'THWR800', layout: 'T1'},
    'D874': {name: 'UVN800', layout: 'UV2'},
    'EC40': {name: 'THN132N/THR238NF', layout: 'T1'}, // example: EC4015F07300D3
    'EA4C': {name: 'THWR288A'},
    'EC70': {name: 'UVR128', layout: 'UV1'},  //mijne in corona
    'F824': {name: 'THGN800/THGN801/THGR810', layout: 'TH1'},
    'F8B4': {name: 'THGR810', layout: 'TH1'}
};

function OregonSensor() {
}

OregonSensor.prototype = {
    decodeChannel: function(data) {
        var res = parseInt(data, 10);
        // fix channel since it is encoded as 1 << (channel - 1) and the channels range is 1-3
        return res === 4 ? 3 : res;
    },
    decodeBattery: function(data) {
        var res = parseInt(data, 10);
        return (res && 0x4) ? true : false;
    },
    decodeHex: function(data) {
        var res = 0;
        for (var i = data.length - 1; i >= 0; i--) {
            res = (res << 4) + parseInt(data.charAt(i), 16);
        }
        return res;
    },
    isValid: function(data, end) {
        var check = this.decodeHex(data.slice(end, end + 2));
        var checksum = 0;
        for (var i = 0; i < end; i++) {
            checksum += parseInt(data.charAt(i), 16);
        }
        // console.log(data.slice(end, end + 2), checksum, check);
        return (checksum === check);
    },
    decode: function(data) {
        if (typeof data !== 'string')
            throw new Error("Invalid arguments");

        if (data.length < 9)
            throw new Error("Data is too short");

        if (data.charAt(0) === 'A') {
            // message sync => remove it
            data = data.slice(1);
        }

        var id = data.slice(0, 4),
            sensor = oregonKnownSensors[id],
            layoutName = (sensor != null ? sensor.layout : null),
            layout = (layoutName != null ? oregonDataLayouts[layoutName] : null);
        if (layout != null) {
            if (this.isValid(data, 8 + layout.len)) {
                var res = {
                    id: id,
                    sensorName: sensor.name,
                    channel: this.decodeChannel(data.slice(4, 5)),
                    rolling: this.decodeHex(data.slice(5, 7)),
                    lowBattery: this.decodeBattery(data.slice(7, 8)),
                    data: {}
                };

                data = data.slice(8);
                for (var p in layout.data) {
                    var value = 0;
                    var elem = layout.data[p];
                    for (var i = elem.len - 1; i >= 0; i--) {
                        value = value * 10 + parseInt(data.charAt(elem.start + i), 10);
                    }
                    if (p == 'direction') {
                        value *= 22.5;
                    } else if (elem.map != null) {
                        value = elem.map[value] || 'Unknown';
                    } else if (p != 'unknown') {
                        value = Number(value);
                        if (elem.div != null) {
                            value /= elem.div;
                        }
                        if (elem.add != null) {
                            value += elem.add;
                        }
                    }
                    res.data[p] = value;
                }
                if (res.data.sign != null) {
                    if (Number(res.data.sign) > 0) {
                        res.data.temperature *= -1;
                    }
                    delete (res.data.sign);
                }
            } else {
                throw new Error('Data is not valid');
            }
        } else {
            throw new Error('Unknown sensor');
        }

        return res;
    }
};

// this layout table made according to the following document:
// http://members.upc.nl/m.beukelaar/Crestaprotocol.pdf

var crestaDataLayouts = {
    0x0C: { // data example: 758FD68C25C124C1349003A8
        name: 'Anemometer',
        data: {
            temperature: {start: 6, len: 2, div: 10},
            tempHigh: {start: 9, len: 1, mul: 10, applyTo: 'temperature', applyAs: 'add'},
            tempSign: {start: 8, len: 1, enc: 'hex', map: {0x4: -1, 0xC: 1}, applyTo: 'temperature', applyAs: 'mul'},
            chill: {start: 10, len: 2, div: 10},
            chillHigh: {start: 13, len: 1, mul: 10, applyTo: 'chill', applyAs: 'add'},
            chillSign: {start: 12, len: 1, enc: 'hex', map: {0x4: -1, 0xC: 1}, applyTo: 'chill', applyAs: 'mul'},
            wind: {start: 14, len: 2, div: 10},
            windHigh: {start: 17, len: 1, mul: 10, applyTo: 'wind', applyAs: 'add'},
            gust: {start: 18, len: 2},
            gustLow: {start: 16, len: 1, div: 10, applyTo: 'gust', applyAs: 'add'},
            direction: {start: 20, len: 1, enc: 'hex', convert: 'windDirSeg', mul: 22.5},
            approaches: {
                start: 21, len: 1, enc: 'hex', map: {
                    0: 'Hasn’t moved from this angle',
                    4: 'Has arrived at this angle via a clockwise rotation',
                    8: 'Has arrived at this angle via a counter clockwise rotation'
                }
            }
        }
    },
    0x0D: { // data example: 758FD0CD0722012800
        name: 'UV sensor',
        data: {
            temperature: {start: 6, len: 2, div: 10},
            tempHigh: {start: 9, len: 1, mul: 10, applyTo: 'temperature', applyAs: 'add'},
            value: {start: 10, len: 2},
            valueLow: {start: 8, len: 1, div: 10, applyTo: 'value', applyAs: 'add'},
            index: {start: 12, len: 2, div: 10},
            indexHigh: {start: 15, len: 1, mul: 10, applyTo: 'index', applyAs: 'add'},
            level: {start: 14, len: 1}
        }
    },
    0x0E: { // data example: 7580CC8ED000662C
        name: 'Rain level meter',
        data: {
            rain: {start: 6, len: 2, enc: 'hex', mul: 0.7},
            rainHigh: {start: 8, len: 2, enc: 'hex', mul: 0x100 * 0.7, applyTo: 'rain', applyAs: 'add'}
        }
    },
    0x1E: { // data example: 7545CE5E87C151F3
        name: 'Thermo/hygro-sensor',
        data: {
            temperature: {start: 6, len: 2, div: 10},
            tempHigh: {start: 9, len: 1, mul: 10, applyTo: 'temperature', applyAs: 'add'},
            sign: {start: 8, len: 1, enc: 'hex', map: {0x4: -1, 0xC: 1}, applyTo: 'temperature', applyAs: 'mul'},
            humidity: {start: 10, len: 2}
        }
    }
};

function CrestaSensor() {

}

CrestaSensor.prototype = {
    getByte: function(data, index) {
        return parseInt(data.slice(index << 1, (index + 1) << 1), 16);
    },
    windDirSeg: function(b) {
        b ^= (b & 8) >> 1;
        b ^= (b & 4) >> 1;
        b ^= (b & 2) >> 1;
        return -b & 0xf;
    },
    decode: function(data) {
        if (typeof data !== 'string')
            throw new Error("Invalid arguments");

        if (data.length < 4)
            throw new Error("Data is too short");

        var header = data.slice(0, 2);
        if (header !== '75')
            throw new Error("Wrong header");
        data = data.slice(2);

        var bt = this.getByte(data, 0);
        var res = {
            channel: bt >> 5,
            rolling: bt & 0x1f
        };
        if (res.channel >= 5)
            res.channel--;
        // get battery flag and package length
        bt = this.getByte(data, 1);
        res.lowBattery = (bt >> 6) == 0;
        var len = (bt >> 1) & 0x1f;
        if (data.length < len << 1)
            throw new Error("Incorrect data length");
        // shrink the data according to the package length
        data = data.slice(0, len * 2);
        // get device type and package number
        bt = this.getByte(data, 2);
        res.packageNumber = (bt >> 5);
        var layout = crestaDataLayouts[bt & 0x1f];
        if (layout != null) {
            res.sensorName = layout.name;
            res.data = {};
            for (var p in layout.data) {
                var value = 0;
                var elem = layout.data[p];
                var base = (elem.enc === 'hex') ? 16 : 10;
                for (var i = 0; i < elem.len; i++) {
                    value = value * base + parseInt(data.charAt(elem.start + i), base);
                }
                if (elem.map != null) {
                    value = elem.map[value] || 'Unknown';
                } else if (p != 'unknown') {
                    value = Number(value);
                    if (elem.convert)
                        value = this[elem.convert](value);
                    if (elem.div != null) {
                        value /= elem.div;
                    }
                    if (elem.mul != null) {
                        value *= elem.mul;
                    }
                    if (elem.add != null) {
                        value += elem.add;
                    }
                }
                if (elem.applyTo) {
                    if (typeof res.data[elem.applyTo] !== 'undefined') {
                        switch (elem.applyAs) {
                            case 'mul':
                                res.data[elem.applyTo] *= value;
                                break;
                            case 'add':
                                res.data[elem.applyTo] += value;
                                break;
                        }
                    }
                } else
                    res.data[p] = value;
            }
        } else {
            throw new Error('Unknown sensor');
        }
        return res;
    }
};

module.exports = {
    OregonSensor: OregonSensor,
    CrestaSensor: CrestaSensor
};