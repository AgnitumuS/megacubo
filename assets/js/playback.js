//import { clearInterval } from 'timers';

var fs = require('fs'), os = require('os'), async = require('async'), ffmpeg = require('fluent-ffmpeg'), peerflix;

var isPlaying = isPending = false;
var cpuCount = os.cpus().length;

ffmpeg.setFfmpegPath('ffmpeg/ffmpeg');

var PlaybackManager = (() => {
    var self = {
		events: [], 
		intents: [], 
		wasLoading: false, 
		activeIntent: false, 
        lastCommitTime: 0,
        intentTypesPriorityOrder: ['magnet', 'direct', 'youtube', 'ffmpeg', 'ts', 'frame'] // ts above direct to ensure
	};
    self.on = (action, callback) => { // register, commit
        action = action.split(' ');
        for(var i=0;i<action.length;i++){
            if(typeof(self.events[action[i]])=='undefined'){
                self.events[action[i]] = [];
            }
            self.events[action[i]].push(callback)
        }
    }
    self.trigger = (action, ...arguments) => {
        doAction(action, self.activeIntent, self);
        if(typeof(self.events[action])!='undefined'){
            var _args = Array.from(arguments);
            for(var i=0; i<self.events[action].length; i++){
                self.events[action][i].apply(null, _args)
            }
        }
    }
    self.data = () => {
        if(self.activeIntent){
            return self.activeIntent.entry;
        }
    }
    self.query = (filter) => { // object
        var results = [];
        for(var i=0; i<self.intents.length; i++){
            ok = true;
            for(var key in filter){
                if(!self.intents[i] || typeof(self.intents[i][key])=='undefined' || self.intents[i][key] != filter[key]){
                    ok = false;
                    break;
                }
            }
            if(ok){
                results.push(self.intents[i])
            }
        }
        return results;
    }
    self.play = () => {
        if(self.activeIntent){
            var r = self.activeIntent.play();
            self.trigger('play');
            return r;
        }
    }
    self.pause = () => {
        if(self.activeIntent){
            var r = self.activeIntent.pause();
            self.trigger('pause');
            return r;
        }
    }
    self.playing = () => {
        if(self.activeIntent){
            return self.activeIntent.playing()
        }
    }
    self.seek = (secs) => {
        if(self.activeIntent){
            var r = self.activeIntent.seek(secs);
            self.trigger('seek');
            return r;
        }
    }
    self.fullStop = () => {
        console.log('STOP');
        self.intents.forEach((intent, i) => {
            self.destroyIntent(intent)
        })
        console.log('FULLY STOPPED', self.intents);
        self.intents = [];
        self.activeIntent = false;
        if(self.wasLoading){
            self.wasLoading = false;
            console.log('load-out')
            self.trigger('load-out');
        }
        self.trigger('stop');
        NativeStop();
        console.log('STOP OK');
    }
    self.stop = () => {
        console.log('STOP');
        if(self.activeIntent){
            self.destroyIntent(self.activeIntent);
            console.log('STOPPED', self.intents);
            self.activeIntent = false;
            self.trigger('stop');
            NativeStop();
        }
        console.log('STOP OK');
    }
    self.getURL = () => {
        if(self.activeIntent){
            return self.activeIntent.entry.originalUrl || self.activeIntent.entry.url;
        }
    }
    self.runFitter = () => { // frames only
        console.log('PlaybackManager.runFitter()');
        var aliveIntents = self.query({type: 'frame'});
        for(var i=0; i<aliveIntents.length; i++){
            aliveIntents[i].runFitter()
        }
    }
    self.isLoading = (fetch) => {
        var loadingIntents;
        if(typeof(fetch)=='string'){
            loadingIntents = self.query({originalUrl: fetch, ended: false, error: false});
            return loadingIntents.length > 0;
        }
        var is = false, urls = [];
        //console.log('LOADING', self, traceback());
        loadingIntents = self.query({started: false, ended: false, error: false, isSideload: false});
        if(fetch === true){
            for(var i=0; i<loadingIntents.length; i++){
                urls.push(loadingIntents[i].entry.url)
            }
            is = urls.length ? urls : [];
        } else {
            is = loadingIntents.length > 0;
        }
        if(self.wasLoading != is){
            console.log('LOADCHANGE');
            self.wasLoading = !!is;
            console.log(is ? 'load-in' : 'load-out')
            self.trigger(is ? 'load-in' : 'load-out')
        }
        return is;
    }
    self.resetIntentsKeys = () => {
        self.intents = self.intents.filter(function (item) {
            return item !== undefined;
        });
    }
    self.cancelLoading = () => {
        if(self.intents.length){
            console.log('CANCEL LOADING', self.log());
            for(var i=0; i<self.intents.length; i++){
                if(self.intents[i] != self.activeIntent){
                    self.destroyIntent(self.intents[i])
                }
            }
            self.resetIntentsKeys();
            console.log('CANCEL LOADING OK', self.log())
        }
    }
    self.log = () => {
        var _log = '', url, state, error;
        for(var i=0; i<self.intents.length; i++){
            state = 'unknown';
            error = self.intents[i].ended || self.intents[i].error;
            if(!error && self.intents[i].started){
                state = 'started';
            } else {
                if(!error){
                    state = 'loading';
                } else if(self.intents[i].ended){
                    state = 'ended';
                } else {
                    state = 'error';
                }
            }
            if(self.intents[i] == self.activeIntent){
                state += ' active';
            }
            if(self.intents[i].isSideload){
                state = 'sideload '+state;
            }
            url = (self.intents[i].prxurl || self.intents[i].entry.url);
            _log += url;
            if(url != self.intents[i].entry.originalUrl){
                _log += " (from "+self.intents[i].entry.originalUrl+")";
            }
            _log += " ("+self.intents[i].type+", "+state+")\r\n";
        }
        return _log;
    }
    self.hasURL = (url) => {
        for(var i=0; i<self.intents.length; i++){
            if(self.intents[i].entry.url == url || self.intents[i].entry.originalUrl == url){
                return true;
                break;
            }
        }
    }
    self.destroyIntent = (intent) => {
        console.log('DESTROYING', intent);
        if(intent){
            try {
                intent.destroy();
            } catch(e) {
                console.error('INTENT DESTROY FAILURE', e)
            }
            var i = self.intents.indexOf(intent);
            if(i != -1){
                delete self.intents[i];
                self.resetIntentsKeys()
            }
        }
    }
    self.checkIntents = () => {
        var concurrent, isNewer, activeIntent = false, loading = false, intents = self.query({started: true, error: false, ended: false});
        for(var i=0; i<intents.length; i++){
            if(intents[i] != self.activeIntent){
                if(activeIntent){ // which of these started intents has higher priority
                    var a = self.intentTypesPriorityOrder.indexOf(activeIntent.type);
                    var b = self.intentTypesPriorityOrder.indexOf(intents[i].type);
                    var c = intents[i].entry.originalUrl.indexOf('#nofit') != -1;
                    isNewer = (b == a) ? (activeIntent.ctime < intents[i].ctime) : (b < a);
                    if(c || isNewer){ // new intent has higher priority than the activeIntent
                        self.destroyIntent(activeIntent);
                        console.log('COMMITING DISCARD', intents[i], self.activeIntent, a, b);                        
                    } else { // keep current activeIntent
                        continue;
                    }
                }
                activeIntent = intents[i];
            }
        }
        if(activeIntent && activeIntent != self.activeIntent){
            self.commitIntent(activeIntent);
            self.trigger('load-out')
        } else if(!intents.length && self.activeIntent) {
            self.activeIntent = false;
            self.stop()
        }
        var was = self.wasLoading, isLoading = self.isLoading();
        if(isLoading){
            setTimeout(self.checkIntents.bind(this), 2000)
        }
        //console.log('ACTIVE', activeIntent, was, isLoading, intents);
    }
    self.registerIntent = (intent) => {
        console.log('REGISTER INTENT', intent, traceback());
        if(self.intents.indexOf(intent)==-1){
            self.intents.push(intent)
        }
        intent.on('start', self.checkIntents.bind(this));
        intent.on('error', self.checkIntents.bind(this));
        intent.on('ended', () => {
            console.log('INTENT ENDED');
            setTimeout(PlaybackManager.checkIntents.bind(PlaybackManager), 1000)
        });
        console.log('REGISTER INTENT 2');
        self.checkIntents();
        self.trigger('register', intent)      
        if(intent.ended){
            intent.trigger('ended')
        } else if(intent.error){
            intent.trigger('error')
        }
        console.log('REGISTER INTENT 3');
    }
    self.commitIntent = (intent) => {
        var concurrent;
        if(self.activeIntent != intent){
            console.log('COMMITING', intent, self.activeIntent, traceback());
            if(self.activeIntent){
                concurrent = ((intent.entry.originalUrl||intent.entry.url) == (self.activeIntent.entry.originalUrl||self.activeIntent.entry.url));
                if(concurrent){ // both are intents from the same stream, decide for one of them
                    var a = self.intentTypesPriorityOrder.indexOf(intent.type);
                    var b = self.intentTypesPriorityOrder.indexOf(self.activeIntent.type);
                    var c = self.activeIntent.entry.originalUrl.indexOf('#nofit') != -1;
                    if(c || b <= a){ // new concurrent intent has lower (or equal) priority than the active intent
                        self.destroyIntent(intent);
                        console.log('COMMITING DISCARD', intent, self.activeIntent, a, b);
                        return false; // keep the current activeIntent
                    }
                }
            }
            var allow = true;
            allow = intent.filter('pre-commit', allow, intent, self.activeIntent);
            if(allow === false){
                console.log('COMMITING DISALLOWED');
                self.destroyIntent(intent);
                return false; // commiting canceled, keep the current activeIntent
            }
            // From here, the intent is already confirmed, so destroy any non-concurrent (different channel) intents and concurrent intents with lower or equal priority
            for(var i=0; i<self.intents.length; i++){
                if(self.intents[i] != intent){
                    var active = (self.activeIntent == self.intents[i]);
                    concurrent = (
                        intent.entry.originalUrl == 
                        self.intents[i].entry.originalUrl
                    );
                    if(active){
                        self.trigger('uncommit', self.activeIntent, intent)
                    }
                    self.activeIntent.committed = false;
                    if(concurrent){
                        var a = self.intentTypesPriorityOrder.indexOf(intent.type);
                        var b = self.intentTypesPriorityOrder.indexOf(self.intents[i].type);
                        if(a <= b){ // keep the current intent
                            self.destroyIntent(self.intents[i])    
                        }
                    } else {
                        self.destroyIntent(self.intents[i])
                    }
                }
            }
            console.log('COMMITING ACTIVE', intent, self.intents);
            if(self.intents.indexOf(intent)==-1){
                self.registerIntent(intent);
            }
            self.activeIntent = intent;
            self.activeIntent.committed = true;
            console.log('COMMITING AA', intent);
            if(typeof(intent.commit)=='function'){
                try {
                    intent.commit()
                } catch(e) {
                    console.error(e)
                }
            }
            console.log('COMMITING BB', intent);
            self.trigger('commit', intent, intent.entry);
            setTimeout(self.initRatio, 100);
            console.log('COMMITING OK', self.intents);
        } else {
            console.log('COMMITING - Already committed.')
        }
        self.lastCommitTime = time()
    }
    self.getVideoSize = () => {
        if(self.activeIntent){
            var v = self.activeIntent.getVideo();
            if(v){
                return {width: v.videoWidth, height: v.videoHeight}
            }
        }
        return {width: 1920, height: 1080}; // some fallback value
    }    
    self.initRatio = () => {
        if(self.activeIntent){
            var v = self.activeIntent.getVideo();
            if(v){
                var w = v.videoWidth || 1920, h = v.videoHeight || 1080, r = w / h;
                var scaleModesInt = scaleModes.map(scaleModeAsInt);
                var c = closest(r, scaleModesInt), k = scaleModesInt.indexOf(c);
                self.setRatio(scaleModes[k])
            }
        }
    }  
    self.getRatio = () => {
        return Config.get('aspect-ratio') || '16:9';
    }
    self.setRatio = (ratio) => {
        if(typeof(ratio)!='string'){
            ratio = self.getRatio();
        } else {
            Config.set('aspect-ratio', ratio)
        }
        if(self.activeIntent){
            var v = self.activeIntent.getVideo();
            if(v){
                console.log(typeof(ratio), ratio);
                ratio = scaleModeAsInt(ratio);
				var w, h, ww = jQuery('#player').width(), wh = jQuery('#player').height(), wratio = ww / wh;
				if(wratio >= ratio){
					h = wh;
                    w = wh * ratio;
				} else {
					w = ww;
					h = ww / ratio;
				}
                console.log('RATIO', w, h, ww, wh, wratio, ratio);
                v.style.setProperty("width", w+"px", "important");
                v.style.setProperty("height", h+"px", "important");
                v.style.setProperty("min-width", w+"px", "important");
                v.style.setProperty("min-height", h+"px", "important");
                v.style.setProperty("top", ((wh - h) / 2)+"px", "important");
                v.style.setProperty("left", ((ww - w) / 2)+"px", "important");
                v.style.setProperty("objectFit", "fill", "important");
            } else {
                console.log('Video element not found.')
            }
        } else {
            console.log('No active intent.')
        }
    }
    return self;
})();

function createPlayIntent(entry, options, callback){
    if(!options) options = {};
    var shadow = (typeof(options.shadow)!='undefined' && options.shadow);
    var initTime = time(), FFmpegIntentsLimit = 8, intents = [];
    var currentPlaybackType = '', currentPlaybackTypePriotity = -1;
    entry.url = String(entry.url); // Parameter "url" must be a string, not object
    entry.originalUrl = entry.originalUrl ? String(entry.originalUrl) : entry.url;
    entry.name = String(entry.name);
    entry.logo = String(entry.logo);
    if(!shadow && PlaybackManager.activeIntent && PlaybackManager.activeIntent.entry.originalUrl == (entry.originalUrl || entry.url)){
        currentPlaybackType = PlaybackManager.activeIntent.type;
        currentPlaybackTypePriotity = PlaybackManager.intentTypesPriorityOrder.indexOf(currentPlaybackType); // less is higher
    }
    console.log('CREATE INTENT', currentPlaybackType, currentPlaybackTypePriotity, entry, options, traceback());
    var internalCallback = (intent) => {
        console.log('_INTENT', intent, intents);
        if(intent){
            if(!shadow){
                PlaybackManager.registerIntent(intent);
            }
            if(callback){
                callback(intent) // before run() to allow setup any event callbacks
            }
            //console.log('INTERNAL', intent, traceback());
            intent.run();
            return intent;
        } else {
            console.log('Error: NO INTENT', intent, entry.url);
        }
    }
    if(typeof(entry.originalUrl) == 'undefined'){
        entry.originalUrl = entry.url;
    }
    console.log(entry.url);
    if(isMega(entry.url)){ // mega://
        if(options.shadow){
            return [];
        }
        console.log('isMega');
        var data = parseMegaURL(entry.url);
        if(!data){
            return [];
        }
        console.log('PARTS', data);
        if(data.type == 'link'){
            entry.url = data.url;
        } else if(data.type == 'play') {
            setTimeout(() => {
                var c = getFrame('controls');
                if(c){
                    notifyRemove(Lang.PLAY_STREAM_FAILURE.split('{')[0]);
                    c.autoCleanNPlay(data.name, null, entry.originalUrl)
                }
            }, 200);
            return [];
        }
    }
    if(getExt(entry.url)=='mega'){ // .mega
        entry = megaFileToEntry(entry.url);
        if(!entry){
            return [];
        }
    }
    if(isRemoteTS(entry.url)){
        // these TS can be >20MB and even infinite (realtime), so it wont run as HTML5, FFMPEG is a better approach so
        console.log('CREATEPLAYINTENT FOR TS', entry.url);
        intents.push(createTSIntent(entry, options))
    } else if(isMagnet(entry.url)){
        console.log('CREATEPLAYINTENT FOR MAGNET', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('magnet') < currentPlaybackTypePriotity){
            intents.push(createMagnetIntent(entry, options))
        }
    } else if(isRTMP(entry.url) || isRTSP(entry.url)){
        console.log('CREATEPLAYINTENT FOR RTMP/RTSP', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('ffmpeg') < currentPlaybackTypePriotity){
            intents.push(createFFmpegIntent(entry, options))
        }
    } else if(isHTML5Video(entry.url) || isM3U8(entry.url)){
        console.log('CREATEPLAYINTENT FOR HTML5/M3U8', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('direct') < currentPlaybackTypePriotity){
            intents.push(createDirectIntent(entry, options))
        }
        /*
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('ffmpeg') < currentPlaybackTypePriotity){
            if(PlaybackManager.query({type: 'ffmpeg', error: false, ended: false}).length < FFmpegIntentsLimit){
                intents.push(createFFmpegIntent(entry, options))
            }
        }
        console.log('CREATEPLAYINTENT FOR HTML5/M3U8', PlaybackManager.intentTypesPriorityOrder.indexOf('direct'), currentPlaybackTypePriotity, intents);
        */
    } else if(isMedia(entry.url)){
        console.log('CREATEPLAYINTENT FOR MEDIA', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('ffmpeg') < currentPlaybackTypePriotity){
            intents.push(createFFmpegIntent(entry, options))
        }
    } else if(isYT(entry.url)){
        console.log('CREATEPLAYINTENT FOR YT', entry.url);
        if(typeof(ytdl)=='undefined'){
            ytdl = require('ytdl-core')
        }
        var id = ytdl.getURLVideoID(entry.url);
        if(id && id != 'live_stream' && entry.url.indexOf('embed') == -1){
            if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('youtube') < currentPlaybackTypePriotity){
                intents.push(createYoutubeIntent(entry, options))
            }
        } else {
            if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('frame') < currentPlaybackTypePriotity){
                intents.push(createFrameIntent(entry, options))
            }
        }
    } else if(['html', 'htm'].indexOf(getExt(entry.url))!=-1) {
        console.log('CREATEPLAYINTENT FOR GENERIC', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('frame') < currentPlaybackTypePriotity){
            if(!options || !options.sideload){
                intents.push(createFrameIntent(entry, options))
            }
        }
    } else  {
        console.log('CREATEPLAYINTENT FOR GENERIC', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('frame') < currentPlaybackTypePriotity){
            if(!options || !options.sideload){
                intents.push(createFrameIntent(entry, options))
            }
        }
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('ffmpeg') < currentPlaybackTypePriotity){
            if(PlaybackManager.query({type: 'ffmpeg', error: false, ended: false}).length < FFmpegIntentsLimit){
                intents.push(createFFmpegIntent(entry, options)) // not sure, so we'll race the possible intents
            }
        }
    }
    intents.forEach((intent, index) => {
        internalCallback(intent)
    });
    return intents;
}

function createBaseIntent(){

    var self = {};
    self.type = 'base';
    self.top = top; // reference for listeners
    self.isSideload = false;
    self.shadow = false;
    self.manual = false;
    self.loaded = false;
    self.started = false;
    self.error = false;
    self.ended = false;
    self.attached = false;
    self.videoElement = false;
    self.sideloads = [];
    self.entry = {};
    self.events = {};
    self.ctime = time();
    self.committed = false;
    self.controller = getFrame('player');

    self.on = (action, callback) => { // register, commit
        action = action.split(' ');
        for(var i=0;i<action.length;i++){
            if(typeof(self.events[action[i]])=='undefined'){
                self.events[action[i]] = [];
            }
            self.events[action[i]].push(callback)
        }
    }

    self.off = (action, callback) => { // register, commit
        if(self && self.events){
            if(action){
                action = action.split(' ')
            } else {
                action = Object.keys(self.events)
            }
            for(var i=0;i<action.length;i++){
                if(typeof(self.events[action[i]])!='undefined'){
                    if(callback){
                        var p = self.events[action[i]].indexOf(callback)
                        if(p != -1){
                            delete self.events[action[i]][p];
                        }
                    } else {
                        self.events[action[i]] = [];
                    }
                }
            }
        }
    }

    self.trigger = (action, ...arguments) => {
        var _args = Array.from(arguments);
        if(self && self.events && jQuery.isArray(self.events[action])){
            console.log(action, traceback());
            console.log(self.events[action]);
            console.log(self.events[action].length);
            for(var i=0; self && self.events[action] && i<self.events[action].length; i++){
                self.events[action][i].apply(null, _args)
            }
        }
    }

    self.filter = (action, ...arguments) => {
        var _args = Array.from(arguments);
        if(jQuery.isArray(self.events[action])){
            for(var i=0; self.events[action] && i<self.events[action].length; i++){
                if(!_args[0]){
                    break;
                }
                _args[0] = self.events[action][i].apply(null, _args)
            }
        }
        return _args[0];
    }

    self.play = () => {
        if(self.controller){
            self.controller.play();
            self.trigger('play')
        }
    }

    self.pause = () => {
        if(self.controller){
            self.controller.pause();
            self.trigger('pause')
        }
    }
    
    self.seek = (secs) => {
        if(self.controller){
            self.controller.seek(secs)
        }
    }

    self.playing = () => {
        if(self.committed){
            if(self.controller){
                return !self.controller.paused();
            } else {
                return true;
            }
        }
    }

    self.getVideo = () => {
        if(!self.videoElement || !self.videoElement.parentNode){
            self.videoElement = getFrame('player').videoElement()
        }
        return self.videoElement;
    }

    self.sideload = (url) => {
        var debug = true;
        if(self.shadow || !self.manual){
            console.log('SIDELOAD DISALLOW', 'testing entry');
            return;
        }
        if(self.error || self.ended){
            console.log('SIDELOAD DISALLOW', 'we\'ve already gave up');
            return;
        }
        var surl = removeQueryString(url);
        if(self.sideloads.indexOf(surl) === -1){ // not already tried
            self.sideloads.push(surl);
            if(self.entry.url.indexOf('#nofit') == -1){
                var fine = true, loadingIntents = PlaybackManager.query({started: false, ended: false, error: false, isSideload: false}); // disallow sideloading if there are other channel intents loading already
                loadingIntents.forEach((intent) => {
                    if(intent.entry.originalUrl != self.entry.originalUrl){
                        fine = false;
                    }
                }); 
                if(!fine){
                    console.log('SIDELOAD DISALLOW', 'other channel is loading');
                    return false;
                }
                var parentSelf = self, entry = Object.assign({}, self.entry);
                entry.url = url;
                if(debug){
                    console.log('SIDELOADPLAY OK', entry, surl)
                }
                createPlayIntent(entry, {isSideload: true, manual: true, 'pre-commit': (allow, intent) => {
                    if(debug){
                        console.log('PRE-COMMIT', allow, intent)
                    }
                    if(parentSelf.error || parentSelf.ended){ 
                        console.log('PRE-COMMIT DISALLOW', intent, PlaybackManager.intents, 'we already gave up *');
                        return false;
                    }
                    if(PlaybackManager.activeIntent){
                        // playing something
                        if(PlaybackManager.activeIntent.entry.originalUrl == intent.entry.originalUrl){
                            // playing the same channel, check intent type priority so
                            var currentPlaybackTypePriotity = PlaybackManager.intentTypesPriorityOrder.indexOf(PlaybackManager.activeIntent.type); // less is higher
                            var newPlaybackTypePriotity = PlaybackManager.intentTypesPriorityOrder.indexOf(intent.type); // less is higher
                            if(newPlaybackTypePriotity < currentPlaybackTypePriotity){
                                console.log('PRE-COMMIT OK, higher priority');
                            } else {
                                console.log('PRE-COMMIT DISALLOW (priotity)', intent, PlaybackManager.intents, newPlaybackTypePriotity, currentPlaybackTypePriotity);
                                return false;
                            }
                        } else {
                            // playing other channel, commit anyway so
                            // remember, on hit play on a channel, cancel any inactive or loading intents, keep only the "actually playing" intent
                            // ... 
                            console.log('PRE-COMMIT OK, changing channel');
                        }
                    } else {
                        // not yet playing, not it will be!
                        console.log('PRE-COMMIT OK, wasn\'t playing');
                    }
                }, error: (...arguments) => {
                    console.error('SIDELOADPLAY ERROR', url, arguments)
                }, ended: (...arguments) => {
                    console.error('SIDELOADPLAY ENDED', url, arguments)
                }})
                return true;
            } else {
                if(debug){
                    //console.log('SIDELOADPLAY SKIP, already trying that *') // url already (side)loading
                }
            }
        } else {
            if(debug){
                //console.log('SIDELOADPLAY SKIP, already tried that **', self.sideloads) // no frame intent
            }
        }
    }

    self.apply = (options) => {
        for(var key in options){
            if(typeof(options[key])=='function'){
                self.on(key, options[key])
            } else if(key == 'maxTimeout'){
                self.setMaxTimeout(options[key])
            } else {
                self[key] = options[key];
            }
        }
    }

    self.destroy = () => {
        if(self && self.trigger){
            self.trigger('destroy')  
        }
    }   

    self.clear = () => {
        if(self.tester){
            self.tester.cancel();
            self.tester = null;
        } 
        if(self.decoder){
            self.decoder.kill('SIGKILL');
            if (self.decoder.file) {
                removeFolder(dirname(self.decoder.file), true);
            }
            self.decoder = null;
        }
        self.events = [];
        self.attached = self.videoElement = false;  
    }    

    self.on('error destroy', () => {
        self.attached = false; 
        if(self.frame){
            self.frame.src = 'about:blank';
            if(self.frame.parentNode){
                self.frame.parentNode.removeChild(self.frame)
            }
            self.frame = null;
        }
        if(self.tester){
            self.tester.cancel();
            self.tester = null;
        } 
        if(self.decoder){
            self.decoder.kill('SIGKILL');
            if (self.decoder.file) {
                removeFolder(dirname(self.decoder.file), true);
            }
            self.decoder = null;
        }
        self.videoElement = false;  
        console.warn('Intent cleaned.')
    })

    self.on('destroy', () => {
        self.ended = true;
        self.attached = false; 
    })

    self.timeout = 0;
    self.timeoutSecs = 0;
    
    self.calcTimeout = (secs) => {
        return (((typeof(self.maxTimeout)!='undefined' && self.maxTimeout && self.maxTimeout < secs) ? sef.maxTimeout : secs) * 1000);
    }
    
    self.setTimeout = (secs) => {
        clearInterval(self.timeout);
        if(!self.committed && !self.error){
            var s = time();
            self.timeout = setTimeout(() => {
                if(self && !self.committed && !self.error && !self.ended){
                    console.error('Connect timeout.', s, time() - s);
                    self.error = true;
                    self.trigger('error')
                }
            }, self.calcTimeout(secs))
        }
    }
    
    self.setMaxTimeout = (secs) => {
        self.maxTimeout = secs;
        if(!self.committed && !self.error && (typeof(self.maxTimeout)!='undefined' && (!self.timeoutSecs || self.maxTimeout < self.timeoutSecs))){
            clearInterval(self.timeout);
            var s = time();
            self.timeout = setTimeout(() => {
                if(self && !self.committed && !self.error && !self.ended){
                    console.error('Connect timeout.', s, time() - s);
                    self.error = true;
                    self.trigger('error')
                }
            }, self.calcTimeout(secs))
        }
    }

    self.setTimeout(30);

    return self;
}

function createFrameIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'frame';
    self.entry = entry;
    self.fittedElement = false;
    self.fittedScope = false;
    self.allowMediaSourcePausing = true;
    
    self.frame = document.createElement('iframe');
    self.frame.className = "fit-screen hide"; 
    self.frame.nwdisable = true;
    self.frame.nwfaketop = true;
    self.frame.height = "100%";
    self.frame.setAttribute('allowFullScreen', '');
    document.querySelector('body').appendChild(self.frame);

    self.run = () => {    
        if(self.entry.url.substr(0, 4)=='http'){
            getHTTPContentType(self.entry.url, (ct) => {
                if(!self.error && !self.ended){
                    console.log('Content-Type', self.entry.url, ct);
                    if(!ct || ['text/html'].indexOf(ct.toLowerCase()) != -1){
                        self.runConfirm()
                    } else {
                        console.error('Bad content type for '+self.type, ct);
                        self.error = true;
                        self.trigger('error')
                    }
                }
            })        
        } else {
            console.error('Not HTTP(s)', self.entry.url);
            self.error = true;
            self.trigger('error')
        }
    }

    self.detectDOMLoad = (callback) => {
        var c = false;
        if(self && self.frame && (c=self.allowFitter())){
            if(c.document.readyState.match(new RegExp('(complete|interactive)', 'i'))){
                callback()
            } else {
                setTimeout(() => {
                    self.detectDOMLoad(callback)
                }, 100)
            }
        }
    }
    
    self.runConfirm = () => {
        if(self.frame){ // if thats no frame, its already destroyed
            var loadCallback = () => {
                //alert('self.frame.src');
                self.runFitter()
            } 
            // use onload (run again after navigates) + detectDOMLoad (fire earlier)
            self.frame.onload = loadCallback;
            setTimeout(() => {
                self.detectDOMLoad(loadCallback)
            }, 400);
            self.frame.src = self.entry.url; // after the onload hook setup
            if(self.manual && (self.entry.originalUrl || self.entry.url).match(new RegExp('#(catalog|nosandbox|nofit)([^A-Za-z0-9]|$)'))){
                self.started = true;
                self.trigger('start');
            }
        }
    }

    self.fitterCallback = (result) => {
        if(result && result.element){
            console.log('runFitter SUCCESS', result);
            self.fittedElement = result.element;
            self.fittedScope = result.scope;
            self.getVideo();
            self.started = true;
            self.trigger('start')
            console.log('runFitter SUCCESS', result);
        }
    }
    
    self.allowFitter = () => {
        if(!self.ended && !self.error){
            if(fitterEnabled && self && self.frame){
                var c = false;
                try {
                    c = self.frame.contentWindow;
                } catch(e) {
                    console.error(e)
                }
                if(c && (!self.fittedElement || !self.fittedScope  || !self.fittedScope.document || !self.fittedScope.document.querySelector('body').contains(self.fittedElement))){
                    return c;
                }
            }
        }
    }

    self.runFitter = () => {
        var interval = 3000;
        if(self.fitterTimer){
            clearTimeout(self.fitterTimer)
        }
        self.fitterTimer = setTimeout(() => {
            if(self.fitterTimer){
                clearTimeout(self.fitterTimer)
            }
            var c = self.allowFitter();
            if(c){
                console.log('intent.runFitter()', time());
                Fitter.start(c, self);
                self.fitterTimer = setTimeout(self.runFitter, interval);
                console.log('intent.runFitter() OK')
            }
        }, 50);
        return self.started;
    }
      
    self.commit = () => {
        NativeStop();
        jQuery(document).find('iframe#sandbox').not(self.frame).remove();
        jQuery(self.frame).removeClass('hide').addClass('show').prop('id', 'sandbox');
        self.frame.id = 'sandbox';
        var w = self.fittedScope || self.frame.contentWindow || false;
        if(w){
            patchFrameWindowEvents(w)
        }
    }

    self.play = () => {
        if(self.getVideo()){
            if(self.allowMediaSourcePausing || self.videoElement.currentSrc.indexOf('blob:')==-1){
                self.videoElement.play()
            }
        }
    }

    self.pause = () => {
        if(self.getVideo()){
            if(self.allowMediaSourcePausing || self.videoElement.currentSrc.indexOf('blob:')==-1){
                self.videoElement.pause()
            } else {
                notify(Lang.CANNOT_PAUSE, 'fa-exclamation-circle', 'normal')
            }
        }
    }
    
    self.seek = (secs) => {
        if(self.getVideo()){
            if(self.allowMediaSourcePausing || self.videoElement.currentSrc.indexOf('blob:')==-1){
                self.videoElement.currentTime += secs;
            }
        }
    }

    self.playing = () => {
        if(self.committed){
            if(self.getVideo()){
                return !self.videoElement.paused;
            } else {
                return true;
            }
        }
    }

    self.getVideo = () => {
        if(!self.videoElement && self.fittedElement){
            if(self.fittedElement.tagName && self.fittedElement.tagName.toLowerCase()=='video'){
                self.videoElement = self.fittedElement;
            } else {
                if(self.fittedElement.querySelector){
                    self.videoElement = self.fittedElement.querySelector('video')
                } else if(self.fittedScope && self.fittedScope.document) {
                    self.videoElement = self.fittedScope.document.querySelector('video')
                }
            }
            if(self.videoElement){
                console.log('PATCHING VIDEO', self.videoElement, self.videoElement.src, self.videoElement.currentTime);
                prepareVideoObject(self.videoElement);
                self.videoElement.muted = false;
                PlaybackManager.setRatio()
            }
        }
        return self.videoElement;
    }

    self.on('error destroy', () => {
        if(self.frame){
            self.frame.src = 'about:blank';
            jQuery(self.frame).remove();
            delete self.frame;
        }
    });

    self.on('commit', () => {
        document.querySelector('body').appendChild(self.frame);
    });

    
    document.querySelector('body').appendChild(self.frame);

    if(options){
        self.apply(options)
    }

    document.body.appendChild(self.frame);

    return self;

}

function createDirectIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'direct';
    self.entry = entry;
    self.prx = false;
    self.prxurl = false;
    self.tester = false;
    self.mimetype = '';
        
    self.commit = () => {
        jQuery('#player').removeClass('hide').addClass('show');
        NativePlayURL(self.prxurl, self.mimetype, 
            () => { // started
                self.videoElement = getFrame('player').videoElement();
                playPauseNotify()
            },
            () => { // ended
                console.error('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            () => { // error
                console.error('Player error.');
                self.error = true;
                self.trigger('error')
            });
        self.videoElement = self.controller.videoElement();
        self.attached = true;
    }
    
    self.runConfirm = () => {
        self.prxurl = self.entry.url;
        self.mimetype = 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"';
        if(self.prxurl.match(new RegExp('(https?://).*m3u8'))){
            console.log('PRX run');
            self.prx = getHLSProxy();
            self.prxurl = self.prx.getURL(self.prxurl)
        } else {
            self.mimetype = 'video/mp4; codecs="avc1.4D401E, mp4a.40.2"';
        }
        var p = getFrame('testing-player');
        if(!p || !p.test){
            console.error('No iframe#testing-player found.');
            self.error = true;
            self.trigger('error')
        } else {
            console.log('Testing', self.prxurl, self.entry.url, self.mimetype, self, traceback());
            self.tester = p.test(self.prxurl, self.mimetype, () => {
                if(!self.error && !self.ended){
                    console.log('Test succeeded. '+self.prxurl);
                    self.started = true;
                    self.trigger('start')
                }
            }, (data) => {
                if(!self.error && !self.ended){
                    console.error('Test Failed. '+self.prxurl, data);
                    self.error = true;
                    self.trigger('error')
                }
            })
        }
    }

    self.run = () => {    
        if(isLocal(self.entry.url)){
            self.runConfirm()
        } else if(self.entry.url.substr(0, 4)=='http'){
            getHTTPContentType(self.entry.url, (ct) => {
                if(!self.error && !self.ended){
                    console.log('Content-Type', self.entry.url, ct);
                    if(!ct || [
                        'audio/x-mpegurl', 
                        'video/x-mpegurl', 
                        'application/x-mpegurl', 
                        'video/mp2t', 
                        'application/vnd.apple.mpegurl', 
                        'video/mp4', 
                        'audio/mp4', 
                        'video/x-m4v', 
                        'video/m4v',
                        'audio/aac',
                        'application/x-winamp-playlist', 
                        'audio/mpegurl', 
                        'audio/mpeg-url', 
                        'audio/playlist', 
                        'audio/scpls', 
                        'audio/x-scpls'
                        ].indexOf(ct.toLowerCase()) != -1){
                        self.runConfirm()
                    } else {
                        console.error('Bad content type for '+self.type, ct);
                        self.error = true;
                        self.trigger('error')
                    }
                }
            })        
        } else {
            console.error('Not HTTP(s)', self.entry.url);
            self.error = true;
            self.trigger('error')
        }
    }
    
    if(options){
        self.apply(options)
    }

    return self;

}

function createFFmpegIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'ffmpeg';
    self.entry = entry;
    self.folder = '';
    self.proxify = true;
    self.prxurl = false;
    self.prx = false;
    self.transcode = false;
    self.videoCodec = 'copy';

    self.commit = () => {
        jQuery('#player').removeClass('hide').addClass('show');
        NativePlayURL(self.decoder.file, 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"', 
            () => { // started
                self.videoElement = getFrame('player').videoElement();
                playPauseNotify()
            },
            () => { // ended
                console.log('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            (data) => { // error
                console.error('Playback error.', data.originalEvent.path[0].error || data, self.decoder.file);
                self.error = true;
                self.trigger('error')
            });
        self.videoElement = self.controller.videoElement();
        self.attached = true;
    }
    
    self.callDecoder = (ct) => {
        var uid = (new Date()).getTime();
        self.prxurl = self.entry.url;
    
        if(['m3u', 'm3u8'].indexOf(getExt(self.prxurl))!=-1 && self.proxify){
            console.log('PRX run');
            self.prx = getHLSProxy();
            self.prxurl = self.prx.getURL(self.prxurl)
        }

        self.decoder = ffmpeg(self.prxurl).
            addOption('-cpu-used -5').
            addOption('-deadline realtime').
            addOption('-threads ' + (cpuCount - 1)).
            inputOptions('-fflags +genpts').
            inputOptions('-stream_loop 999999').
            videoCodec(self.videoCodec).
            audioCodec('aac').
            addOption('-profile:a', 'aac_low').
            addOption('-preset:a', 'veryfast').
            addOption('-hls_time', segmentDuration).
            addOption('-hls_list_size', 0).
            addOption('-hls_flags', 'delete_segments').
            addOption('-copyts').
            addOption('-sn').
            format('hls');

        if (self.entry.url.indexOf('http') == 0 && isMedia(self.entry.url)) { // skip other protocols
            var agent = navigator.userAgent.split('"')[0];
            self.decoder
                .inputOptions('-user_agent', '"' + agent + '"') //  -headers ""
                .inputOptions('-icy 0')
                .inputOptions('-seekable 1')
            if (!self.proxify){
                self.decoder.inputOptions('-multiple_requests 1')
            }
            if (self.entry.url.indexOf('https') == 0) {
                self.decoder.inputOptions('-tls_verify 0')
            }
        }

        if(self.transcode){
            self.decoder.
                addOption('-pix_fmt', 'yuv420p').
                addOption('-profile:v', 'main').
                addOption('-preset:v', 'veryfast');
        }
    
        // setup event handlers
        self.decoder.
        on('end', () => {
            console.log('file ended');
            if((time() - self.ctime) >= 10 && getExt(self.entry.url)=='ts'){
                console.log('file retry');
                delete self.decoder;
                self.error = false;
                self.ended = false;
                self.run()
            }
        }).
        on('error', function(err) {
            console.error('an error happened: ' + err.message);
            self.error = true;
            self.trigger('error')
        }).
        on('start', function(commandLine) {
            console.log('Spawned FFmpeg with command: ' + commandLine, self.entry, ct);
            // ok, but wait file creation to trigger "start"
        });
    
        self.decoder.file = 'stream/' + uid + '/output.m3u8';
    
        top.mkdirp(dirname(self.decoder.file));
    
        waitInstanceFileExistsTimeout(self, function (exists) {
            if(!self.ended && !self.error){
                if(exists){
                    console.log('M3U8 file created.');
                    self.started = true;
                    self.trigger('start')
                } else {
                    console.error('M3U8 file creation timeout.');
                    self.error = true;
                    self.trigger('error')
                }
            }
        }, 1800);
        self.decoder.output(self.decoder.file).run();
    }
    
    self.run = () => {
        if(self.entry.url.substr(0, 4)=='http'){
            getHTTPContentType(self.entry.url, (ct) => {
                if(!self.error && !self.ended){
                    console.log('Content-Type', self.entry.url, ct);
                    if(ct.indexOf('text/html') != -1){
                        console.error('Bad content type for '+self.type, ct);
                        self.error = true;
                        self.trigger('error');
                        return;
                    }
                    self.transcode = (!ct || [
                        'audio/x-mpegurl', 
                        'video/x-mpegurl', 
                        'application/x-mpegurl', 
                        'video/mp2t', 
                        'application/vnd.apple.mpegurl', 
                        'video/mp4', 
                        'audio/mp4', 
                        'video/x-m4v', 
                        'video/m4v',
                        'audio/aac',
                        'application/x-winamp-playlist', 
                        'audio/mpegurl', 
                        'audio/mpeg-url', 
                        'audio/playlist', 
                        'audio/scpls', 
                        'audio/x-scpls',
                        'text/html'
                        ].indexOf(ct.toLowerCase()) == -1);
                    //self.transcode = 1;
                    self.videoCodec = self.transcode ? 'libx264' : 'copy';
                    self.callDecoder(ct)
                }
            })        
        } else {
            self.callDecoder(null)
        }
    }

    var DVRTime = 3 * 3600; // secs
    var segmentDuration = 5; // secs

    if(options){
        self.apply(options);
        //console.log('ZZZZ', options, self);
    }

    return self;

}

function createTSIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'ts';
    self.entry = entry;
    self.folder = '';
    self.proxify = true;
    self.prxurl = false;
    self.prx = false;
    self.transcode = false;
    self.videoCodec = 'copy';
    self.uid = 0;
    self.softErrors = [];
    self.tsDuration = 0;
    self.tsFetchStart = 0;
    
    var uid = (new Date()).getTime(), file = 'stream/' + uid + '/output.m3u8';

    self.commit = () => {
        jQuery('#player').removeClass('hide').addClass('show');
        NativePlayURL(self.decoder.file, 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"', 
            () => { // started
                var pl = getFrame('player');
                self.videoElement = pl.videoElement();
                pl.player.off('ended');
                pl.player.on('ended', () => {
                    console.log('PLAYER RESET');
                    pl.reset()
                });
                playPauseNotify();
            },
            () => { // ended
                console.log('Playback ended.'); // wait for FFMPEG chunks
                self.ended = true;
                self.trigger('ended')
            },
            () => { // error
                console.log('Player error.');
                self.error = true;
                self.trigger('error')
            });
        self.videoElement = self.controller.videoElement();
        self.attached = true;
    }

    top.mkdirp(dirname(file));
    
    self.runConfirm = () => {
        self.mimetype = 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"';
        self.prxurl = getTSWrapper().getURL(self.entry.url);

        if(self.decoder){
            try {
                self.decoder.kill('SIGKILL')
            } catch(e) {}
        }

        self.decoder = ffmpeg(self.prxurl).
        addOption('-cpu-used -5').
        addOption('-deadline realtime').
        addOption('-threads ' + (cpuCount - 1)).
        inputOptions('-fflags +genpts').
        inputOptions('-stream_loop -1').
        videoCodec(self.videoCodec).
        audioCodec('aac').
        addOption('-profile:a', 'aac_low').
        addOption('-preset:a', 'veryfast').
        addOption('-hls_time', segmentDuration).
        addOption('-hls_list_size', 0).
        addOption('-vsync 1').
        addOption('-copyts').
        addOption('-sn').
        format('hls');
    
        var hlsFlags = 'delete_segments', alreadyExists = fs.existsSync(file);
        if(alreadyExists) {
            hlsFlags += ' append_list';
        } else {
            top.mkdirp(dirname(file));   
        }
        self.decoder.addOption('-hls_flags', hlsFlags);

        if (self.entry.url.indexOf('http') == 0 && isMedia(self.entry.url)) { // skip other protocols
            var agent = navigator.userAgent.split('"')[0];
            self.decoder.inputOptions('-multiple_requests 1')
                .inputOptions('-user_agent', '"' + agent + '"') //  -headers ""
                .inputOptions('-icy 0')
                .inputOptions('-seekable 1')
            if (self.entry.url.indexOf('https') == 0) {
                self.decoder.inputOptions('-tls_verify 0')
            }
        }
    
        // setup event handlers
        self.decoder.
        on('end', (err) => {
            console.log('file ended', err);
            if(!self.error && !self.ended && self.attached){
                console.log('file restart');
                self.runConfirm()
            }
        }).
        on('error', function(err) {
            console.error('an error happened: ' + err.message);
            self.error = true;
            self.trigger('error')
        }).
        on('start', function(commandLine) {
            console.log('Spawned FFmpeg with command: ' + commandLine);
            // ok, but wait file creation to trigger "start"
        });    
        self.decoder.file = file;     
        waitInstanceFileExistsTimeout(self, function (exists) {
            if(!self.ended && !self.error){
                if(exists){
                    console.log('M3U8 file created.');
                    self.started = true;
                    self.trigger('start');
                } else {
                    console.error('M3U8 file creation timeout.');
                    self.error = true;
                    self.trigger('error')
                }
            }
        }, 1800);
        self.decoder.output(self.decoder.file).run()
    }

    self.run = () => {    
        if(isLocal(self.entry.url)){
            self.runConfirm()
        } else if(self.entry.url.substr(0, 4)=='http'){
            getHTTPContentType(self.entry.url, (ct) => {
                if(!self.error && !self.ended){
                    console.log('Content-Type', self.entry.url, ct);
                    if(!ct || [
                        'audio/x-mpegurl', 
                        'video/x-mpegurl', 
                        'application/x-mpegurl', 
                        'video/mp2t', 
                        'application/vnd.apple.mpegurl', 
                        'video/mp4', 
                        'audio/mp4', 
                        'video/x-m4v', 
                        'video/m4v',
                        'audio/aac',
                        'application/x-winamp-playlist', 
                        'audio/mpegurl', 
                        'audio/mpeg-url', 
                        'audio/playlist', 
                        'audio/scpls', 
                        'audio/x-scpls'
                        ].indexOf(ct.toLowerCase()) != -1){
                        if(!self.error && !self.ended){
                            self.runConfirm()
                        }
                    } else {
                        console.error('Bad content type for '+self.type, ct);
                        self.error = true;
                        self.trigger('error')
                    }
                }
            })        
        } else {
            console.error('Not HTTP(s)', self.entry.url);
            self.error = true;
            self.trigger('error')
        }
    }

    var DVRTime = 3 * 3600; // secs
    var segmentDuration = 5; // secs

    if(options){
        self.apply(options);
        console.log('ZZZZ', options, self);
    }

    return self;

}

function createMagnetIntent(entry, options){
    
    var self = createBaseIntent();
    self.transcode = !!entry['transcode'];
    self.videoCodec = self.transcode ? 'libx264' : 'copy';
    self.type = 'magnet';
    self.entry = entry;
    self.folder = '';
    self.peerflix = false;
    self.endpoint = false;
    self.progressTimer = 0;
    self.unpaused = false;
    self.useDecoder = false;
        
    self.commit = () => {
        NativePlayURL(self.useDecoder ? self.decoder.file : self.endpoint, self.useDecoder ? 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"' : 'video/mp4', 
            () => { // started
                self.videoElement = getFrame('player').videoElement();
                /*
                console.log('STARTS');
                if(0 && !self.unpaused){
                    self.unpaused = true;
                    self.videoElement = getFrame('player').videoElement();
                    //playPauseNotify()
                    var o = getFrame('overlay');
                    if(o){
                        jQuery(o.document).one('mousemove', () => {
                            console.log('WAKENPLAY');
                            PlaybackManager.play()
                        })
                    }
                }
                */
            },
            () => { // ended
                console.error('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            () => { // error
                console.error('Player error.');
                self.error = true;
                self.trigger('error')
            }, false);
        jQuery('#player').removeClass('hide').addClass('show');
        self.attached = true;
        self.videoElement = self.controller.videoElement();
        self.on('play', self.hideStats);
        self.on('pause', self.showStats);
        top.focus()
    }

    self.showStats = () => {
        if(self.notify){
            self.subNotify.show();
            self.notify.show()
        }
    }

    self.hideStats = () => {
        if(self.notify){
            self.subNotify.hide();
            self.notify.hide()
        }
    }
    
    self.run = () => {
        console.log('run() called');
        self.subNotify = notify(Lang.CAN_BE_SLOW, 'fa-coffee', 'wait');
        self.notify = notify(Lang.SEARCHING_PEERS, 'fa-magnet', 'wait');
        notifyRemove(Lang.CONNECTING);
        if(self.endpoint){
            console.log('About to stream...');
            self.stream()
        }
    }

    self.destroy = () => {
        if(self.notify){
            self.subNotify.close();
            self.notify.close()
        }
        clearInterval(self.progressTimer);
        self.peerflix.destroy();
        self.trigger('destroy')
    }
    
    self.stream = () => {
        if(self.useDecoder){
            self.decoder = ffmpeg(self.endpoint).
            addOption('-cpu-used -5').
            addOption('-deadline realtime').
            addOption('-threads ' + (cpuCount - 1)).
            inputOptions('-fflags +genpts').
            inputOptions('-stream_loop -1').
            videoCodec(self.videoCodec).
            audioCodec('aac').
            addOption('-profile:a', 'aac_low').
            addOption('-preset:a', 'veryfast').
            addOption('-hls_time', segmentDuration).
            addOption('-hls_list_size', 0).
            addOption('-hls_flags', 'delete_segments').
            addOption('-copyts').
            addOption('-sn').
            format('hls');
    
            if(self.transcode){
                self.decoder.
                    addOption('-pix_fmt', 'yuv420p').
                    addOption('-profile:v', 'main').
                    addOption('-preset:v', 'veryfast');
                    //addOption('-g 15').
                    //addOption('-cluster_size_limit 10M').
                    //addOption('-cluster_time_limit 10K').
                    //addOption('-movflags +faststart+frag_keyframe+empty_moov+default_base_moof').
                    //addOption('-x264opts no-scenecut')
            }
        
            if (self.entry.url.indexOf('http') == 0 && isMedia(self.entry.url)) { // skip other protocols
                var agent = navigator.userAgent.split('"')[0];
                self.decoder.inputOptions('-multiple_requests 1')
                    .inputOptions('-user_agent', '"' + agent + '"') //  -headers ""
                    .inputOptions('-icy 0')
                    .inputOptions('-seekable 1')
                if (self.entry.url.indexOf('https') == 0) {
                    self.decoder.inputOptions('-tls_verify 0')
                }
            }
        
            // setup event handlers
            self.decoder.
            on('end', () => {
                console.log('file ended');
            }).
            on('error', function(err) {
                console.error('an error happened: ' + err.message);
                self.error = true;
                self.trigger('error')
            }).
            on('start', function(commandLine) {
                console.log('Spawned FFmpeg with command: ' + commandLine);
                // ok, but wait file creation to trigger "start"
            });    
            self.decoder.file = 'stream/' + uid + '/output.m3u8';    
            top.mkdirp(dirname(self.decoder.file));    
            waitInstanceFileExistsTimeout(self, function (exists) {
                if(!self.ended && !self.error){
                    if(exists){
                        console.log('M3U8 file created.');
                        self.started = true;
                        self.trigger('start');
                        clearInterval(self.progressTimer);
                        if(self.notify){
                            self.notify.update(false, false, 'short');
                            self.subNotify.close()
                        }
                    } else {
                        console.error('M3U8 file creation timeout.');
                        self.error = true;
                        self.trigger('error')
                    }
                }
            }, 1800);
            self.decoder.output(self.decoder.file).run()
        } else {
            self.started = true;
            self.trigger('start');
            clearInterval(self.progressTimer);
            if(self.notify){
                self.notify.update(false, false, 'short');
                self.subNotify.close()
            }
        }
    }
    if(!peerflix){
        peerflix = require('peerflix')
    }
    self.peerflix = peerflix(self.entry.url, {tmp:'torrent'});
    self.peerflix.server.on('listening', () => {
        self.endpoint = 'http://127.0.0.1:' +  self.peerflix.server.address().port + '/';
        self.stream()
    });
    var minAmountToStart = 10000000;
    self.progressTimer = setInterval(() => {
        if(!self.peerflix.torrent){
            console.log('Something wrong with', self.entry)
        } else if(self.notify){
            var downloaded = 0;
            for (var i = 0; i < self.peerflix.torrent.pieces.length; i++) {
                if (self.peerflix.bitfield.get(i)){
                    downloaded++;
                }
            }      
            //var totalp = (downloaded / (self.peerflix.torrent.pieces.length / 100));
            var p = (downloaded * self.peerflix.torrent.pieceLength) / (minAmountToStart / 100);
            //console.log('QQQQQQQQQQQQQ', downloaded, self.peerflix.torrent.pieces.length, p);
            if(p >= 100){
                if(self.endpoint){
                    p = 100;
                    duration = 'short';
                } else {
                    p = 99;
                }
            }
            if(p > 0){
                self.subNotify.close()
            }
            self.notify.update(Lang.LOADING+' '+parseInt(p)+'% &middot; '+formatBytes(self.peerflix.swarm.downloadSpeed())+'/s', 'fa-magnet')
        }
    }, 1000);

    var uid = (new Date()).getTime();
    var DVRTime = 3 * 3600; // secs
    var segmentDuration = 5; // secs

    if(options){
        self.apply(options)
    }
    
    return self;

}

function createYoutubeIntent(entry, options){
    
    var self = createBaseIntent();
    self.transcode = !!entry['transcode'];
    self.videoCodec = 'copy';
    self.audioCodec = 'copy';
    self.type = 'youtube';
    self.entry = entry;
    self.folder = '';
    self.ytdl = false;
    self.endpoint = false;
    self.progressTimer = 0;
    self.ctype = 'video/mp4; codecs="avc1.4D401E, mp4a.40.2"';
        
    self.commit = () => {
        NativePlayURL(self.endpoint, self.ctype, 
            () => { // started
                self.videoElement = getFrame('player').videoElement();
                playPauseNotify()
            },
            () => { // ended
                console.error('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            () => { // error
                console.error('Player error.');
                self.error = true;
                self.trigger('error')
            });
        jQuery('#player').removeClass('hide').addClass('show');
        self.attached = true;
        self.videoElement = self.controller.videoElement();
        top.focus()
    }
    
    self.run = () => {
        console.log('run() called');
        if(typeof(ytdl)=='undefined'){
            ytdl = require('ytdl-core')
        }
        var id = ytdl.getURLVideoID(self.entry.url);
        console.log('run() id', id, self.entry.url);
        ytdl.getInfo(id, (err, info) => {
            if (err){
                console.log('YTDL error');
                self.error = true;
                self.trigger('error')
                throw err;
            } else {
                console.log('YT Info', info);
                var live = [];
                for(var i=0;i<info.formats.length;i++){
                    if(info.formats[i].live){ // live stream 
                        console.log('YT Info live', info.formats[i]);
                        if(info.formats[i].profile == 'main' && info.formats[i].audioEncoding == 'aac' && isM3U8(info.formats[i].url)){ // compatible m3u8
                            console.log('YT Info live OK', info.formats[i]);
                            live.push(info.formats[i])
                        }
                    } else if(!live.length) {
                        console.log('YT Info', info.formats[i]);
                        if(info.formats[i].type.match('mp4.*,')){ // mp4 including audio
                            self.endpoint = info.formats[i].url;
                            self.ctype = info.formats[i].type;
                            self.started = true;
                            self.trigger('start');
                            return;
                            break;
                        }
                    }
                }
                if(live.length){

                    /*
                    var playlist = "#EXTM3U\r\n";
                    live.reverse().forEach((stream) => {
                        var bitrate = stream.bitrate;
                        bitrate = bitrate.split('-').pop();
                        bitrate = parseFloat(bitrate) * 1000000;
                        playlist += "#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH="+bitrate+", CODECS=\"avc1.4D401E, mp4a.40.2\"\r\n";
                        playlist += getHLSProxy().getURL(stream.url) + "\r\n\r\n";
                    })
                    var playlistFile = 'stream/'+id+'/index.m3u8';
                    mkdirp(dirname(playlistFile));
                    fs.writeFile(playlistFile, playlist, () => {
                        var hr = self.sideload(playlistFile);
                        if(hr){
                            console.warn('Sideload called', playlistFile, playlist);
                            // dont trigger error for now
                        } else {
                            console.error('Sideload refused', playlistFile, playlist);
                        }
                        self.error = true;
                        self.trigger('error')
                        return;
                    });
                    */
                    
                    var hr = self.sideload('https://www.youtube.com/embed/'+id+'?autoplay=1&showinfo=0&iv_load_policy=3&rel=0&modestbranding=1');
                    if(hr){
                        console.warn('Sideload called', playlistFile, playlist);
                        // dont trigger error for now
                        setTimeout(() => {
                            self.error = true;
                            self.trigger('error');
                        }, 15000); // give some ttl to the sideload created
                    } else {
                        console.error('Sideload refused', playlistFile, playlist);
                        self.error = true;
                        self.trigger('error');
                    }
                    return;
                }
                console.error('No compatible formats', info);
                self.error = true;
                self.trigger('error')
            }
        })
    }

    self.destroy = () => {
        clearInterval(self.progressTimer);
        self.trigger('destroy') 
    }

    var uid = (new Date()).getTime();
    var DVRTime = 3 * 3600; // secs
    var segmentDuration = 5; // secs

    if(options){
        self.apply(options)
    }
    
    return self;

}

var currentScaleMode = 0, scaleModes = ['16:9', '4:3', '16:10', '21:9'];
function changeScaleMode(){
    if(top.PlaybackManager.activeIntent){
        var v = top.PlaybackManager.activeIntent.videoElement;
        if(v){
            currentScaleMode++;
            if(currentScaleMode >= scaleModes.length){
                currentScaleMode = 0;
            }
            top.PlaybackManager.setRatio(scaleModes[currentScaleMode]);
            notify('Scale: '+scaleModes[currentScaleMode], 'fa-expand', 'short');
            if(miniPlayerActive){
                var ratio = scaleModeAsInt(scaleModes[currentScaleMode]), nwh = jQuery('body').height(), nww = Math.round(nwh * ratio);
                console.log('QQQ', nww, nwh, ratio);
                window.resizeTo(nww, nwh);
                window.moveTo(screen.availWidth - nww - miniPlayerRightMargin, screen.availWidth - nwh)
            }       
        }        
    }
}

function scaleModeAsInt(scaleMode){
    var n = scaleMode.split(':');
    return parseInt(n[0]) / parseInt(n[1])
}

function NativePlayURL(dest, mimetype, started, ended, error, paused) {
    showPlayers(true, false);
    if(!mimetype){
        mimetype = 'application/x-mpegURL';
    }
    console.log('WAITREADY');
    var pl = getFrame('player');
    pl.src(dest, mimetype);
    pl.ready(() => {
        var ap = false, v = jQuery(pl.document.querySelector('video'));
        if(v){
            if(started){
                console.log('STARTED', ap, paused);
                if(!ap && paused){
                    ap = true;
                    setTimeout(() => {
                        console.log('PAUSING');
                        PlaybackManager.pause() // use PlaybackManager to trigger the notifies from createMagnetIntent
                    }, 400)
                }
                v.off('play').on('play', started)
            }
            if(error){
                v.off('error').on('error', error)
            }
            if(ended){
                v.off('ended').on('ended', ended)
            }
        }
        leavePendingState()
    })
}

function NativeStop() {
    var pl = getFrame('player');
    pl.stop()
}

if(typeof(http)=='undefined'){
    http = require('http')
}

var HLSProxyInstance, HLSProxyCaching = {}, fetchAgent = new http.Agent({ 
    keepAlive: true 
}), fetchOpts = {
    redirect: 'follow',
    agent: fetchAgent
};

function getHLSProxy(){
    if(!HLSProxyInstance){
        var debug = false, port = 0, closed;
        HLSProxyInstance = http.createServer((request, response) => {
            if(closed){
                return;
            }
            if(debug){
                console.log('request starting...', request);
            }
            var headers = { 
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*'
            }
            var url = request.url.split('#')[0];
            if(request.url.substr(0, 3) == '/s/'){
                url = request.url.replace('/s/', 'https://');
            }
            if(url.indexOf('crossdomain.xml')!=-1){
                headers['Content-Type']  = 'text/xml';
                response.writeHead(200, headers);
                response.write("<?xml version=\"1.0\"?>\r\n<!-- http://www.osmf.org/crossdomain.xml -->\r\n<!DOCTYPE cross-domain-policy SYSTEM \"http://www.adobe.com/xml/dtds/cross-domain-policy.dtd\">\r\n<cross-domain-policy>\r\n<allow-access-from domain=\"*\" secure=\"false\"/>\r\n<allow-http-request-headers-from secure=\"false\" headers=\"*\" domain=\"*\"/>\r\n</cross-domain-policy>");
                response.end();
                return;
            }
            if(url.charAt(0)=='/'){
                url = "http:/"+url;
            }
            if(debug){
                console.log('serving', url);
            }
            var code = 200;
            if(HLSProxyCaching !== false && typeof(HLSProxyCaching[url]) != 'undefined' && (time() - HLSProxyCaching[url].time) <= 3){
                if(debug){
                    console.log('HLS Proxy caching used', url);
                }
                response.writeHead(code, headers);
                response.write(HLSProxyCaching[url].content, 'binary');
                response.end();
                return;
            }
            if(getExt(url) == 'ts'){
                if(debug){
                    console.log('start fetching...')
                }
                HLSProxyInstance.fetch(url, (buffer, headers, code) => {
                    headers['Content-Type'] = 'video/MP2T';
                    if(debug){
                        console.log('responding', buffer)
                    }
                    if(buffer instanceof ArrayBuffer){
                        buffer = Buffer.from(buffer);
                    } else {
                        buffer = String(buffer)
                    }
                    if(HLSProxyCaching !== false){
                        HLSProxyCaching[headers['Location'] || url] = {time: time(), content: buffer};
                        HLSProxyCaching = sliceObject(HLSProxyCaching, -6)
                    }
                    response.writeHead(code, headers);
                    response.write(buffer, 'binary');
                    response.end();
                    if(debug){
                        console.log('fine.')
                    }
                    doAction('media-received', url, buffer, 'content');
                    buffer = null;
                })
            } else {
                HLSProxyInstance.fetch(url, (buffer, headers, code) => {
                    headers['Content-Type'] = 'application/x-mpegURL';
                    var content, ignoreHeaders = 'content-encoding,content-length';
                    for(var k in headers){
                        if(ignoreHeaders.indexOf(k.toLowerCase()) != -1){
                            delete headers[k]
                        }
                    }
                    if(debug){
                        console.log('responding', buffer);
                    }
                    if(buffer instanceof ArrayBuffer){
                        content = Buffer.from(buffer).toString('utf8');
                    } else {
                        content = String(buffer)
                    }
                    if(debug){
                        console.log('responding 2', url, content)
                    }
                    if(content.substr(0, 192).indexOf('#EXT')!=-1){ // really is m3u8
                        //if(content.indexOf('.ts')!=-1){
                            //stuff below was causing errors, dont remember why I've put that here
                            //var entries = content.split('#EXTINF');
                            //if(entries.length > 5){
                            //    content = [entries[0].replace(new RegExp('#EXT\-X\-MEDIA\-SEQUENCE[^\r\n]+[\r\n]+', 'mi'), '')].concat(entries.slice(-5)).join('#EXTINF');
                            //}
                        //}
                        var matches = content.match(new RegExp('https?://[^\r\n ]', 'gi'));
                        if(matches){
                            for(var i=0; i<matches.length; i++){
                                content = content.replaceAll(matches[i], HLSProxyInstance.getURL(matches[i]))
                            }
                        }
                    }
                    if(debug){
                        console.log('headers', headers);
                    }
                    response.writeHead(code, headers);
                    response.write(content);
                    response.end();
                    content = null;
                })
            }
        }).listen();
        addAction('media-received', (url, content, type) => {
            if(type == 'content' && typeof(HLSProxyCaching[url])=='undefined'){ // ignore "path" type, as him is local
                HLSProxyCaching[url] = {time: time(), content: content};
                HLSProxyCaching = sliceObject(HLSProxyCaching, -6)
            }
        });
        HLSProxyInstance.fetch = (url, callback) => {
            var code = 200, headers = { 
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*'
            };
            var invocation = new XMLHttpRequest();
            invocation.open('GET', url, true);
            invocation.responseType = "arraybuffer";
            invocation.onreadystatechange = () => {
                if(closed){
                    invocation.abort()
                } else if(invocation.readyState == 4){
                    code = invocation.status || 200;
                    invocation.getAllResponseHeaders().split("\n").forEach((s) => {
                        var p = s.indexOf(':');
                        if(p){
                            s = [toTitleCase(s.substr(0, p)), s.substr(p + 1).trim()]; 
                            if(s[0] && typeof(headers[s[0]])=='undefined'){
                                headers[s[0]] = s[1]; 
                            }
                        }
                    });
                    if(invocation.responseURL && invocation.responseURL != url) {
                        code = 302;
                        headers['Location'] = HLSProxyInstance.getURL(invocation.responseURL);
                        if(debug){
                            console.log('location: '+headers['Location']);
                        }
                    }
                    if(callback){
                        callback(invocation.response, headers, code);
                        delete invocation
                        delete callback;
                    }
                }
            };
            invocation.send(null)
        }
        HLSProxyInstance.getURL = (url) => {
            if(!port){
                port = HLSProxyInstance.address().port;
            }
            var match = url.match(new RegExp('127\\.0\\.0\\.1:([0-9]+)'))
            if(match){
                url = url.replace(':'+match[1]+'/', ':'+port+'/');
            } else {
                url = url.replace('http://', 'http://127.0.0.1:'+port+'/').replace('https://', 'http://127.0.0.1:'+port+'/s/')
            }
            return url;
        }
        HLSProxyInstance.destroy = () => {
            console.warn('Closing...');
            closed = true;
            if(HLSProxyInstance){
                HLSProxyInstance.close()
                HLSProxyInstance = null;
            }
        }
    }
    return HLSProxyInstance;
}

var TSWrapperInstance;

function getTSWrapper(){
    if(!TSWrapperInstance){
        var debug = false, closed, port = 0, request = require('request').forever();
        TSWrapperInstance = http.createServer((request, client) => {
            if(debug){
                console.log('request starting...', request);
            }
            var headers = { 
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'video/MP2T',
                'Transfer-Encoding': 'chunked'
            }
            var url = request.url.split('#')[0];
            if(request.url.substr(0, 3) == '/s/'){
                url = request.url.replace('/s/', 'https://');
            }
            if(url.charAt(0)=='/'){
                url = "http:/"+url;
            }
            if(debug){
                console.log('serving', url);
            }
            var code = 200, streamer;
			if(debug){
				console.log('start fetching...')
			}
			client.writeHead(code, headers);
			client.on('finish', function () {
				console.log('server: client finish');
				if(streamer){
					streamer.abort()
				}
			});
			client.on('close', function () {
				console.log('server: client close');
				if(streamer){
					streamer.abort()
				}
			});
			streamer = TSWrapperInstance.streamer(url, (buffer) => {
                if(closed){
                    console.log('server: late data', buffer.length);
                    client.end()
                } else if(buffer) {
                    //console.log('server: responding', buffer.length);
                    client.write(buffer, 'binary')
                }
			}, client)
        }).listen();
        TSWrapperInstance.streamer = (url, callback, client) => {
            //var r, aborted, nextIntersectBuffer, bytesToIgnore = 0, intersectBuffers = [], intersectBufferSize = 2 * 1024, maxIntersectBufferSize = 4 * (1024 * 1024), sliceSize = maxIntersectBufferSize / 2;
            var r, aborted, nextIntersectBuffer, bytesToIgnore = 0, intersectBuffers = [], intersectBufferSize = 1024, maxIntersectBufferSize = 3 * (1024 * 1024), sliceSize = maxIntersectBufferSize / 2;
            var abort = () => {
				if(debug){
                    console.log('server: streamer close')
                }
                aborted = true;
                intersectBuffers = [];
                nextIntersectBuffer = null;
                if(r){
                    r.abort()
                    r = null;
                }
            }
            var intersectBuffersSum = () => {
                var length = 0;
                intersectBuffers.forEach((buffer) => {
                    length += buffer.length;
                });
                return length;
            }
            var connect = () => {
				if(!aborted && !closed){
					r = request({method: 'GET', uri: url}, function (error, response, body) {
                        if(!nextIntersectBuffer){
                            nextIntersectBuffer = true;
                        }
                        if(!aborted && !closed){
                            if(debug){
                                console.log('server: host closed, reconnect')
                            }
                            connect()
                        }
					}).on('response', function(response) {
						response.on('data', function(data) {
                            if(!aborted && !closed){
                                //data = toBuffer(data);
                                var currentIntersectBufferSize = intersectBuffersSum();
                                if(nextIntersectBuffer){
                                    if(debug){
                                        console.log('server: intersection', currentIntersectBufferSize, maxIntersectBufferSize);
                                    }
                                    var offset = -1;
                                    try {
                                        console.warn('TS Joining', url);
                                        offset = Buffer.concat(intersectBuffers).lastIndexOf(data.slice(0, intersectBufferSize));
                                        console.warn('TS Joining', offset, currentIntersectBufferSize, data.length)
                                    } catch(e) {
                                        console.error(e)
                                    }         
                                    if(offset != -1){
                                        bytesToIgnore = currentIntersectBufferSize - offset;
                                        if(bytesToIgnore < data.length){
                                            callback(data.slice(bytesToIgnore))
                                        } else {
                                            bytesToIgnore -= data.length;
                                        }
                                    } else {
                                        callback(data)
                                    }
                                    nextIntersectBuffer = null;
                                } else {
                                    //console.log('server: responding', data.length);
                                    if(bytesToIgnore){
                                        if(data.length > bytesToIgnore){
                                            if(debug){
                                                console.log('server: ignore 2')
                                            }
                                            data = data.slice(bytesToIgnore);
                                            bytesToIgnore = 0;
                                        } else {
                                            if(debug){
                                                console.log('server: ignore 1')
                                            }
                                            bytesToIgnore -= data.length;
                                            return;
                                        }
                                    }
                                    if(currentIntersectBufferSize > maxIntersectBufferSize){
                                        intersectBuffers = intersectBuffers.slice(1);
                                    }  
                                    intersectBuffers.push(data);
                                    //console.log(data);
                                    //top.zaz = data;
                                    callback(data)
                                }
                            } else {
                                client.end()
                            }
						})
					})
				} else {
                    abort()
                }
			};
			connect();
			return {'request': r, 'abort': abort}
        }
        TSWrapperInstance.getURL = (url) => {
            if(!port){
                port = TSWrapperInstance.address().port;
            }
            var match = url.match(new RegExp('127\\.0\\.0\\.1:([0-9]+)'))
            if(match){
                url = url.replace(':'+match[1]+'/', ':'+port+'/');
            } else {
                url = url.replace('http://', 'http://127.0.0.1:'+port+'/').replace('https://', 'http://127.0.0.1:'+port+'/s/')
            }
            return url;
        }
        TSWrapperInstance.destroy = () => {
            console.warn('Closing...');
            closed = true;
            if(TSWrapperInstance){
                TSWrapperInstance.close()
                TSWrapperInstance = null;
            }
        }
    }
    return TSWrapperInstance;
}

jQuery(window).on('beforeunload', () =>{
    console.warn('Closing servers');
    if(TSWrapperInstance){
        TSWrapperInstance.destroy()
    }
    if(HLSProxyInstance){
        HLSProxyInstance.destroy()
    }
    console.warn('Closing servers OK');
});

function waitFileExistsTimeout(file, callback, timeout, startedAt) {
    if(typeof(startedAt)=='undefined'){
        startedAt = time();
    }
	fs.stat(file, function(err, stat) {
		if (err == null) {
			callback(true);
		} else if((time() - startedAt) >= timeout) {
			callback(false);
        }
		else {
			setTimeout(() => {
				waitFileExistsTimeout(file, callback, timeout, startedAt);
			}, 250);
		}
	});
}

function waitInstanceFileExistsTimeout(self, callback, timeout, startedAt) {
    if(typeof(startedAt)=='undefined'){
        startedAt = time();
    }
    //console.log('WAIT', self);
    if(self && self.decoder && typeof(self.decoder.file)=='string'){
        fs.stat(self.decoder.file, function(err, stat) {
            if (err == null) {
                callback(true);
            } else if((time() - startedAt) >= timeout) {
                callback(false);
            } else if(self.ended || self.error) {
                console.log('waitInstanceFileExistsTimeout discarded.');
            }
            else {
                setTimeout(() => {
                    waitInstanceFileExistsTimeout(self, callback, timeout, startedAt);
                }, 250);
            }
        })
    }
}

function onIntentCommit(intent){
    //console.log('ONINTENTCOMM');
    setTitleData(intent.entry.name, intent.entry.logo);
    var c = getFrame('controls');
    if(c){
        //console.log('ONINTENTCOMM', intent.entry);
        var entries = c.findEntries(intent.entry.url);
        //console.log('ONINTENTCOMM', intent.entry);
        c.setStreamStateCache(intent.entry, true); // this already update entries flags
        //console.log('ONINTENTCOMM', intent.entry);
        c.History.add(intent.entry);
        //console.log('ONINTENTCOMM', intent.entry, c.History);
        c.updateStreamEntriesFlags()
    }
    notify(intent.entry.name, 'fa-play', 'short');
}

function unfocus(e){ // unfocus from sandbox frame to catch keypresses
    var target = e.srcElement;
    if(!target || typeof(target['tagName'])=='undefined' || ['input', 'textarea'].indexOf(target['tagName'].toLowerCase())==-1){
        //console.log(e);
        console.log('REFOCUS(*)');
        top.focus()
    }
}

function defaultFrameDragOver(e){
    e.preventDefault(); 
    top.ondragover(e);
    return false;
}

function patchFrameWindowEvents(frameWindow){    
    if(frameWindow && frameWindow.document && frameWindow.ondragover !== defaultFrameDragOver){
        frameWindow.ondragover = defaultFrameDragOver;
        createMouseObserverForControls(frameWindow);
        frameWindow.document.addEventListener('keydown', (e) => { // forward keyboard to top where the hotkeys are registered
            if(!e.target || !e.target.tagName || ['input', 'textarea'].indexOf(e.target.tagName.toLowerCase())==-1){ // skip text inputs
                var n = e.originalEvent;
                setTimeout(() => {
                    try {
                        top.document.dispatchEvent(n)  
                    } catch(e) {}
                }, 10)
            }
        });
        frameWindow.document.addEventListener('mouseup', unfocus);
        frameWindow.document.addEventListener('click', (e) => {
            setTimeout(() => {unfocus(e)}, 400)
        });
        frameWindow.ondrop = function(e) { e.preventDefault(); return false };
    }
}

function unloadFrames(){
    Array.from(document.getElementsByTagName('iframe')).forEach((frame) => {
        frame.src = 'about:blank';
    })
}

function delayedPlayPauseNotify(){
    setTimeout(() => {
        playPauseNotify()
    }, 250)
    setTimeout(() => {
        playPauseNotify()
    }, 1000)
}

function shouldNotifyPlaybackError(intent){
    console.log('SHOULD', intent);
    if(intent.manual && !intent.shadow){
        var url = intent.entry.originalUrl;
        for(var i=0; i<PlaybackManager.intents.length; i++){
            if(PlaybackManager.intents[i].entry.originalUrl == url && PlaybackManager.intents[i] != intent && !PlaybackManager.intents[i].error && !PlaybackManager.intents[i].ended){
                console.log('SHOULD', false, PlaybackManager.intents[i], intent);
                return false;
            }
        }
        console.log('SHOULD', true);
        return true;
    }
    return false;
}

PlaybackManager.on('play', delayedPlayPauseNotify);
PlaybackManager.on('pause', delayedPlayPauseNotify);
PlaybackManager.on('register', function (intent, entry){
    intent.on('error', () => {
        setTimeout(() => {
            if(shouldNotifyPlaybackError(intent)){ // don't alert user if has concurrent intents loading
                notify(Lang.PLAY_STREAM_FAILURE.format(intent.entry.name), 'fa-exclamation-circle', 'normal');
                console.log('STREAM FAILED', intent.entry.originalUrl, PlaybackManager.log());
                var c = getFrame('controls');
                if(c){
                    c.setStreamStateCache(intent.entry, false);
                    sendStats('error', c.sendStatsPrepareEntry(intent.entry))
                } else {
                    sendStats('error', intent.entry)
                }
            }
        }, 200)
    })
})
PlaybackManager.on('commit', function (intent, entry){
    console.log('COMMIT TRIGGERED');
    var c = getFrame('controls');
    if(c){
        c.setStreamStateCache(entry, true);
    }
    onIntentCommit(intent);
    intent.on('ended', () => {
        // end of stream, go next
        var c = getFrame('controls');
        if(!isLive(intent.entry.url)){
            var next = getNextStream();
            if(c && next){
                setTimeout(() => {
                    c.playEntry(next)
                }, 1200)
            } else {
                stop()
            }
        }
    })
    delayedPlayPauseNotify();
    var c = getFrame('controls');
    if(c){
        sendStats('alive', c.sendStatsPrepareEntry(entry))
    } else {
        sendStats('alive', entry)
    }
    leavePendingState();
    setTimeout(() => {
        if(PlaybackManager.activeIntent){
            PlaybackManager.setRatio()
        }
    }, 200)
});
PlaybackManager.on('stop', () => {
    delayedPlayPauseNotify();
    setTimeout(() => {
        if(!PlaybackManager.intents.length){
            stop(true)
        }
        delayedPlayPauseNotify()
    }, 1000);
});
PlaybackManager.on('load-in', () => {
    var title, intents = PlaybackManager.query({started: false, ended: false, error: false, isSideload: false});
    if(intents.length){
        title = Lang.CONNECTING.replaceAll('.', '').trim()+': '+(decodeURIComponent(intents[0].entry.name)||intents[0].entry.name);
    } else {
        title = Lang.CONNECTING;
    }
    if(!isPending){
        enterPendingState(title)
    }
});
PlaybackManager.on('load-out', () => {
    leavePendingState();
    var c = getFrame('controls');
    if(c){
        c.updateStreamEntriesFlags()
    }
});

addAction('stop', () => {
    var c = getFrame('controls');
    if(c){
        c.updateStreamEntriesFlags()
    }
    if(isMiniPlayerActive()){
        leaveMiniPlayer()
    }
    sendStats('stop')
});

jQuery(window).on('beforeunload', () => {
    removeFolder('stream', false);
    stop();
    unloadFrames()
});
