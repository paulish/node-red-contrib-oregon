/* ===================================================
 *  ook.js - javascript implementation of RcOok.cpp
 *  (https://github.com/1000io/OregonPi)
 * ---------------------------------------------------
 *  433 Mhz decoding OoK frame from Oregon Scientific
 *
 *  Javascript code: 01 nov 2016 by Paul Ishenin
 * ----------------------------------------------------
 *  From original code:
 * ----------------------------------------------------
 *  Created on: 16 sept. 2013
 *  Author: disk91 ( http://www.disk91.com ) modified from
 *   Oregon V2 decoder added - Dominique Pierre
 *   Oregon V3 decoder revisited - Dominique Pierre
 *   RwSwitch :  Copyright (c) 2011 Suat Özgür.  All right reserved.
 *     Contributors:
 *        - Andre Koehler / info(at)tomate-online(dot)de
 *        - Gordeev Andrey Vladimirovich / gordeev(at)openpyro(dot)com
 *        - Skineffect / http://forum.ardumote.com/viewtopic.php?f=2&t=48
 *        Project home: http://code.google.com/p/rc-switch/
 *
 *   New code to decode OOK signals from weather sensors, etc.
 *   2010-04-11 <jcw@equi4.com> http://opensource.org/licenses/mit-license.php
 *	 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * 	 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * 	 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * 	 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *	 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * 	 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * 	 THE SOFTWARE.
 * ===================================================
 */

var util = require('util');

var hexChars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];
var STATE_UNKNOWN = 0,
    STATE_T0 = 1,
    STATE_T1 = 2,
    STATE_T2 = 3,
    STATE_T3 = 4,
    STATE_OK = 5,
    STATE_DONE = 6;

function Decoder() {
    this.data = new Uint8Array(25);
}

Decoder.prototype = {
    state: STATE_UNKNOWN,
    total_bits: 0,
    bits: 0,
    pos: 0,
    flip: 0,
    reverse: false,
    nextPulse: function(width) {
        if (this.state !== STATE_DONE) {
            switch (this.decode(width)) {
                case -1:
                    this.reset();
                    break;
                case 1:
                    this.done();
                    break;
            }
            return this.isDone();
        }
    },
    isDone: function() {
        return this.state === STATE_DONE;
    },
    reset: function() {
        this.total_bits = 0;
        this.bits = 0;
        this.pos = 0;
        this.flip = 0;
        this.state = STATE_UNKNOWN;
    },
    // add one bit to the packet data buffer
    gotBit: function(value) {
        this.data[this.pos] = (this.data[this.pos] >> 1) | (value << 7);
        this.total_bits++;

        if (++this.bits >= 8) {
            this.bits = 0;
            if (++this.pos >= this.data.length) {
                return this.reset();
            }
        }
        this.state = STATE_OK;
    },
    // store a bit using Manchester encoding
    manchester: function(value) {
        this.flip ^= value; // manchester code, long pulse flips the bit
        this.gotBit(this.flip);
    },
    // move bits to the front so that all the bits are aligned to the end
    alignTail: function(max) {
        // align bits
        if (this.bits != 0) {
            this.data[this.pos] >>= 8 - this.bits;
            for (var i = 0; i < this.pos; ++i)
                this.data[i] = (this.data[i] >> this.bits) | (this.data[i + 1] << (8 - this.bits));
            this.bits = 0;
        }
        // optionally shift bytes down if there are too many of 'em
        if (max > 0 && this.pos > max) {
            var n = this.pos - max;
            this.pos = max;
            for (var i = 0; i < this.pos; ++i)
                this.data[i] = this.data[i + n];
        }
    },
    decode: function() {
        // if no version is specified then always skip
        return 0;
    },
    done: function() {
        while (this.bits)
            this.gotBit(0); // padding
        this.state = STATE_DONE;
    },
    // return the received value as hex
    sprint: function() {
        var res = "", i;
        if (this.reverse) {
            for (i = 0; i < this.pos; ++i) {
                res += hexChars[this.data[i] & 0x0F];
                res += hexChars[this.data[i] >> 4];
            }
        } else {
            for (i = 0; i < this.pos; ++i) {
                res += hexChars[this.data[i] >> 4];
                res += hexChars[this.data[i] & 0x0F];
            }
        }
        return res;
    }
};

function OregonDecoderV2() {
    Decoder.call(this);
    this.reverse = true;
}

util.inherits(OregonDecoderV2, Decoder);

OregonDecoderV2.prototype.gotBit = function(value) {
    if (!(this.total_bits & 0x01)) {
        this.data[this.pos] = (this.data[this.pos] >> 1) | (value ? 0x80 : 00);
    }
    this.total_bits++;
    this.pos = this.total_bits >> 4;
    if (this.pos >= this.data.length) {
        return this.reset();
    }
    this.state = STATE_OK;
};

OregonDecoderV2.prototype.decode = function(width) {
    if (200 <= width && width < 1200) {
        var w = width >= 700;
        switch (this.state) {
            case STATE_UNKNOWN:
                if (w != 0) {
                    // Long pulse
                    ++this.flip;
                } else if (24 <= this.flip) {
                    //BugFix : initialement on test 32b mais il semble que
                    // tous n'en aient pas autant, en tout cas on constate
                    // plus de message reçus avec 24 que 32 ; obligatoire pour THN132N

                    // Short pulse, start bit
                    this.flip = 0;
                    this.state = STATE_T0;
                } else {
                    // Reset decoder
                    return -1;
                }
                break;
            case STATE_OK:
                if (w == 0) {
                    // Short pulse
                    this.state = STATE_T0;
                } else {
                    // Long pulse
                    this.manchester(1);
                }
                break;
            case STATE_T0:
                if (w == 0) {
                    // Second short pulse
                    this.manchester(0);
                } else {
                    // Reset decoder
                    return -1;
                }
                break;
        }
    } else {
        // Dans le cas du THN132N on a seulement 136b
        // donc si on depasse le timing et que l'on a 136b
        // c'est sans doute qu'il s'agit de celui-ci
        return (this.total_bits === 136 ) ? 1 : -1;
    }
    return this.total_bits === 160 ? 1 : 0;
};

function OregonDecoderV3() {
    Decoder.call(this);
    this.reverse = true;
}

util.inherits(OregonDecoderV3, Decoder);

OregonDecoderV3.gotBit = function(value) {
    this.data[this.pos] = (this.data[this.pos] >> 1) | (value ? 0x80 : 00);
    this.total_bits++;
    this.pos = this.total_bits >> 3;
    if (this.pos >= this.data.length) {
        return this.reset();
    }
    this.state = STATE_OK;
};

OregonDecoderV3.decode = function(width) {
    if (200 <= width && width < 1200) {
        var w = width >= 700;
        switch (this.state) {
            case STATE_UNKNOWN:
                if (w == 0)
                    ++this.flip;
                else if (32 <= this.flip) {
                    this.flip = 1;
                    this.manchester(1);
                } else
                    return -1;
                break;
            case STATE_OK:
                if (w == 0)
                    this.state = STATE_T0;
                else
                    this.manchester(1);
                break;
            case STATE_T0:
                if (w == 0)
                    this.manchester(0);
                else
                    return -1;
                break;
        }
    } else {
        return -1;
    }
    return this.total_bits === 80 ? 1 : 0;
};

function CrestaDecoder() {
    Decoder.call(this);
}

util.inherits(CrestaDecoder, Decoder);

CrestaDecoder.prototype.decode = function(width) {
    if (200 <= width && width < 1300) {
        var w = width >= 750;
        switch (this.state) {
            case STATE_UNKNOWN:
                if (w == 1)
                    ++this.flip;
                else if (2 <= this.flip && this.flip <= 10)
                    this.state = STATE_T0;
                else
                    return -1;
                break;
            case STATE_OK:
                if (w == 0)
                    this.state = STATE_T0;
                else
                    this.gotBit(1);
                break;
            case STATE_T0:
                if (w == 0)
                    this.gotBit(0);
                else
                    return -1;
                break;
        }
    } else if (width >= 2500 && this.pos >= 7)
        return 1;
    else
        return -1;
    return 0;
};

function KakuDecoder() {
    Decoder.call(this);
}

util.inherits(KakuDecoder, Decoder);

KakuDecoder.prototype.decode = function(width) {
    if ((180 <= width && width < 450) || (950 <= width && width < 1250)) {
        var w = width >= 700;
        switch (this.state) {
            case STATE_UNKNOWN:
            case STATE_OK:
                if (w == 0)
                    this.state = STATE_T0;
                else
                    return -1;
                break;
            case STATE_T0:
                if (w)
                    this.state = STATE_T1;
                else
                    return -1;
                break;
            case STATE_T1:
                this.state += w + 1;
                break;
            case STATE_T2:
                if (w)
                    this.gotBit(0);
                else
                    return -1;
                break;
            case STATE_T3:
                if (w == 0)
                    this.gotBit(1);
                else
                    return -1;
                break;
        }
    } else if (width >= 2500 && 8 * this.pos + this.bits == 12) {
        for (var i = 0; i < 4; ++i)
            this.gotBit(0);
        this.alignTail(2);
        return 1;
    } else
        return -1;
    return 0;
};

function XrfDecoder() {
    Decoder.call(this);
}

util.inherits(XrfDecoder, Decoder);

// see also http://davehouston.net/rf.htm
XrfDecoder.prototype.decode = function(width) {
    if (width > 2000 && this.pos >= 4)
        return 1;
    if (width > 5000)
        return -1;
    if (width > 4000 && this.state == STATE_UNKNOWN)
        this.state = STATE_OK;
    else if (350 <= width && width < 1800) {
        var w = width >= 720;
        switch (this.state) {
            case STATE_OK:
                if (w == 0)
                    this.state = STATE_T0;
                else
                    return -1;
                break;
            case STATE_T0:
                this.gotBit(w);
                break;
        }
    } else
        return -1;
    return 0;
};

function HezDecoder() {
    Decoder.call(this);
}

util.inherits(HezDecoder, Decoder);
// see also http://homeeasyhacking.wikia.com/wiki/Home_Easy_Hacking_Wiki
HezDecoder.prototype.decode = function(width) {
    if (200 <= width && width < 1200) {
        var w = width >= 600;
        this.gotBit(w);
    } else if (width >= 5000 && this.pos >= 5 /*&& 8 * pos + bits == 50*/) {
        for (var i = 0; i < 6; ++i)
            this.gotBit(0);
        this.alignTail(7); // keep last 56 bits
        return 1;
    } else
        return -1;
    return 0;
};

function VisonicDecoder() {
    Decoder.call(this);
}

util.inherits(VisonicDecoder, Decoder);
VisonicDecoder.prototype.decode = function(width) {
    if (200 <= width && width < 1000) {
        var w = width >= 600;
        switch (this.state) {
            case STATE_UNKNOWN:
            case STATE_OK:
                this.state = w == 0 ? STATE_T0 : STATE_T1;
                break;
            case STATE_T0:
                this.gotBit(!w);
                if (w)
                    return 0;
                break;
            case STATE_T1:
                this.gotBit(!w);
                if (!w)
                    return 0;
                break;
        }
        // sync error, flip all the preceding bits to resync
        for (var i = 0; i <= this.pos; ++i)
            this.data[i] ^= 0xFF;
    } else if (width >= 2500 && 8 * this.pos + this.bits >= 36 && this.state == STATE_OK) {
        for (var i = 0; i < 4; ++i)
            this.gotBit(0);
        this.alignTail(5); // keep last 40 bits
        // only report valid packets
        var b = this.data[0] ^ this.data[1] ^ this.data[2] ^ this.data[3] ^ this.data[4];
        if ((b & 0xF) == (b >> 4))
            return 1;
    } else
        return -1;
    return 0;
};

function EMxDecoder() {
    Decoder.call(this);
}

util.inherits(EMxDecoder, Decoder);
// see also http://fhz4linux.info/tiki-index.php?page=EM+Protocol
EMxDecoder.prototype.decode = function(width) {
    if (200 <= width && width < 1000) {
        var w = width >= 600;
        switch (this.state) {
            case STATE_UNKNOWN:
                if (w == 0)
                    ++this.flip;
                else if (this.flip > 20)
                    this.state = STATE_OK;
                else
                    return -1;
                break;
            case STATE_OK:
                if (w == 0)
                    this.state = STATE_T0;
                else
                    return -1;
                break;
            case STATE_T0:
                this.gotBit(w);
                break;
        }
    } else if (width >= 1500 && this.pos >= 9)
        return 1;
    else
        return -1;
    return 0;
};

function KSxDecoder() {
    Decoder.call(this);
}

util.inherits(KSxDecoder, Decoder);
// see also http://www.dc3yc.homepage.t-online.de/protocol.htm
KSxDecoder.prototype.decode = function(width) {
    if (200 <= width && width < 1000) {
        var w = width >= 600;
        switch (this.state) {
            case STATE_UNKNOWN:
                this.gotBit(w);
                this.bits = this.pos = 0;
                if (this.data[0] != 0x95)
                    this.state = STATE_UNKNOWN;
                break;
            case STATE_OK:
                this.state = w == 0 ? STATE_T0 : STATE_T1;
                break;
            case STATE_T0:
                this.gotBit(1);
                if (!w)
                    return -1;
                break;
            case STATE_T1:
                this.gotBit(0);
                if (w)
                    return -1;
                break;
        }
    } else if (width >= 1500 && this.pos >= 6)
        return 1;
    else
        return -1;
    return 0;
};

function FSxDecoder() {
    Decoder.call(this);
}

util.inherits(FSxDecoder, Decoder);
// see also http://fhz4linux.info/tiki-index.php?page=FS20%20Protocol
FSxDecoder.prototype.decode = function(width) {
    if (300 <= width && width < 775) {
        var w = width >= 500;
        switch (this.state) {
            case STATE_UNKNOWN:
                if (w == 0)
                    ++this.flip;
                else if (this.flip > 20)
                    this.state = STATE_T1;
                else
                    return -1;
                break;
            case STATE_OK:
                this.state = w == 0 ? STATE_T0 : STATE_T1;
                break;
            case STATE_T0:
                this.gotBit(0);
                if (w)
                    return -1;
                break;
            case STATE_T1:
                this.gotBit(1);
                if (!w)
                    return -1;
                break;
        }
    } else if (width >= 1500 && this.pos >= 5)
        return 1;
    else
        return -1;
    return 0;
};

module.exports = {
    433: {
        OregonDecoderV2: OregonDecoderV2,
        OregonDecoderV3: OregonDecoderV3,
        CrestaDecoder: CrestaDecoder,
        KakuDecoder: KakuDecoder,
        XrfDecoder: XrfDecoder,
        HezDecoder: HezDecoder
    },
    868: {
        VisonicDecoder: VisonicDecoder,
        EMxDecoder: EMxDecoder,
        KSxDecoder: KSxDecoder,
        FSxDecoder: FSxDecoder
    }
};