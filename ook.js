/* ===================================================
 *  ook.js - javascript implementation of RcOok.cpp
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

var hexChars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];
var STATE_UNKNOWN = 0,
    STATE_T0 = 1,
    STATE_T1 = 2,
    STATE_T2 = 3,
    STATE_T3 = 4,
    STATE_OK = 5,
    STATE_DONE = 6;

function Decoder(version) {
    this.data = new Uint8Array(25);
    switch (version) {
        case 2:
            this.gotBit = this.gotBitV2;
            this.decode = this.decodeV2;
            break;
        case 3:
            this.gotBit = this.gotBitV3;
            this.decode = this.decodeV3;
            break;
    }
}

Decoder.prototype = {
    state: STATE_UNKNOWN,
    total_bits: 0,
    bits: 0,
    pos: 0,
    flip: 0,
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
    gotBit: undefined,
    gotBitV2: function(value) {
        if (!(this.total_bits & 0x01)) {
            this.data[this.pos] = (this.data[this.pos] >> 1) | (value ? 0x80 : 00);
        }
        this.total_bits++;
        this.pos = this.total_bits >> 4;
        if (this.pos >= this.data.length) {
            return this.reset();
        }
        this.state = STATE_OK;
    },
    gotBitV3: function(value) {
        this.data[this.pos] = (this.data[this.pos] >> 1) | (value ? 0x80 : 00);
        this.total_bits++;
        this.pos = this.total_bits >> 3;
        if (this.pos >= this.data.length) {
            return this.reset();
        }
        this.state = STATE_OK;
    },
    // store a bit using Manchester encoding
    manchester: function(value) {
        this.flip ^= value; // manchester code, long pulse flips the bit
        this.gotBit(this.flip);
    },
    decode: function() {
        // if no version is specified then always skip
        return 0;
    },
    decodeV2: function(width) {
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
    },
    decodeV3: function(width) {
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
    },
    done: function() {
        while (this.bits)
            this.gotBit(0); // padding
        this.state = STATE_DONE;
    },
    // return the received value as hex
    sprint: function(reverse) {
        var res = "";
        if (reverse) {
            for (var i = 0; i < this.pos; ++i) {
                res += hexChars[this.data[i] & 0x0F];
                res += hexChars[this.data[i] >> 4];
            }
        } else {
            for (var i = 0; i < this.pos; ++i) {
                res += hexChars[this.data[i] >> 4];
                res += hexChars[this.data[i] & 0x0F];
            }
        }
        return res;
    }
};

module.exports = Decoder;