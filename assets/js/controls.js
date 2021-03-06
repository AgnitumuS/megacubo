//import { clearTimeout } from 'timers';


var gui = require('nw.gui'), win = gui.Window.get(), offLabel = ' (off)';
var History = (function (){
    var key = 'history', _this = {}, limit = 48;
    var fullHistory = Store.get(key);
    if(fullHistory === null){
        fullHistory = [];
    }
    _this.get = function (index){
        if(typeof(index)=='number'){
            if(typeof(fullHistory[index])!='undefined'){
                return Object.assign({}, fullHistory[index]);
            }
            return false;
        }
        return fullHistory.slice(0)
    };
    _this.add = function (entry){
        console.log('HISTORY ADD', entry);
        let nentry = Object.assign({}, entry);
        if(typeof(nentry.originalUrl)=='string'){
            nentry.url = nentry.originalUrl; // ignore the runtime changes in URL
        }
        if(typeof(nentry.type)!='undefined'){
            delete nentry.type;
        }
        if(nentry.logo.indexOf('//') == -1){
            nentry.logo = defaultIcons['stream'];
        }
        for(var i in fullHistory){
            if(fullHistory[i].url == nentry.url){
                delete fullHistory[i];
            }
        }
        fullHistory = fullHistory.filter((item) => {
            return !!item
        });
        fullHistory.unshift(nentry);
        fullHistory = fullHistory.slice(0, limit);
        console.log('HISTORY ADDED', fullHistory);
        Store.set(key, fullHistory);
    };
    _this.clear = function (){
        fullHistory = [];
        Store.set(key, fullHistory);
    };
    return _this;
})();

var Recordings = (function (){
    var key = 'recording', _this = {}, limit = 48, _folder = 'recordings', _synced = false;
    var fullRecordings = [];
    _this.get = function (index){
        if(!_synced){
            _this.sync()
        }
        if(typeof(key)=='number'){
            return fullRecordings[key] || false;
        }
        return fullRecordings.slice(0)
    }
    _this.sync = function (){
        let files = fs.readdirSync(_folder), name;
        fullRecordings = [];
        for(var i=0; i<files.length; i++){
            if(files[i].indexOf('.mp4')!=-1){
                name = files[i].replace('.mp4', '')
                fullRecordings.push({
                    name: name,
                    url: absolutize(_folder+'/'+files[i]),
                    type: 'stream',
                    logo: 'fa-film'
                })
            }
        }
    }
    _this.clear = function (){
        removeFolder(_folder, false)
    }
    return _this;
})();

var Bookmarks = (function (){
    var key = 'bookmarks', _this = {};
    var fullBookmarks = Store.get(key);
    if(fullBookmarks === null){
        fullBookmarks = [];
    }
    _this.get = function (index){
        if(typeof(key)=='number'){
            return fullBookmarks[key] || false;
        }
        return fullBookmarks;
    }
    _this.is = function (entry){
        for(var i in fullBookmarks){
            if(fullBookmarks[i].url == entry.url){
                return true;
            }
        }
    }
    _this.add = function (entry){
        let nentry = Object.assign({}, entry);
        if(nentry.originalUrl && nentry.originalUrl != nentry.url){
            nentry.url = nentry.originalUrl;
        }
        for(var i in fullBookmarks){
            if(fullBookmarks[i].url == nentry.url){
                delete fullBookmarks[i];
            }
        }
        fullBookmarks.push(nentry);
        fullBookmarks = fullBookmarks.reverse().filter(function (item) {
            return item !== undefined;
        });
        Store.set(key, fullBookmarks);
    }
    _this.remove = function (entry){
        for(var i in fullBookmarks){
            if(fullBookmarks[i].url == entry.url){
                delete fullBookmarks[i];
            }
        }
        fullBookmarks = fullBookmarks.reverse().filter(function (item) {
            return item !== undefined;
        });
        Store.set(key, fullBookmarks);
    }
    _this.clear = function (){
        fullBookmarks = [];
        Store.set(key, fullBookmarks);
    };
    return _this;
})();

function addFav(s){
    if(!s && areControlsActive()){
        s = selectedEntry();
        if(s && s.type!='stream'){
            s = false;
        }
    }
    if(!s){
        s = currentStream()
    }
    if(s && !Bookmarks.is(s)){
        Bookmarks.add(s);
        notify(Lang.FAV_ADDED.format(s.name), 'fa-star', 'normal');
        refreshListingIfMatch(Lang.BOOKMARKS)
    }
}

function removeFav(s){
    if(!s && areControlsActive()){
        s = selectedEntry();
        if(s && s.type!='stream'){
            s = false;
        }
    }
    if(!s){
        s = currentStream()
    }
    if(s && Bookmarks.is(s)){
        Bookmarks.remove(s);
        notify(Lang.FAV_REMOVED.format(s.name), 'fa-star', 'normal');
        refreshListingIfMatch(Lang.BOOKMARKS)
    }
}

function validateIPTVListURL(url, placeholder){
    if(url && url.length >= 13 && url != placeholder){
        return url;
    }
    return false;
}

function getIPTVListAddr(callback, value) {
    var key = 'iptvlisturl', placeholder = 'http://[...].m3u8';
    if(value) placeholder = value;
    var def = getActiveSource();
    var url = validateIPTVListURL(def, placeholder);
    if(url){
        registerSource(url)
    }
    callback(url);
    //return 'http://pastebin.com/raw/TyG4tRKP';
    //  you find it at Google searching for \"iptv list m3u8 {0} {1}\".
}

function getIPTVListSearchTerm(){
    var locale = getDefaultLocale(false, false);
    var country = top.Countries.select(locale, 'country_'+locale.substr(0, 2)+',country_iso', 'locale', true); //getLocale();
    var q = "iptv list m3u8 {0} {1}".format(country, (new Date()).getFullYear());
    return q;
}

function getIPTVListSearchURL(){
    var q = getIPTVListSearchTerm();
    q = q.replaceAll(" ", "+");
    return "https://www.google.com/search?safe=off&tbs=qdr:m&q="+q+"&oq="+q;
}

function sendStatsPrepareEntry(stream){
    if(stream){
        stream.uiLocale = getLocale(false, false);
        stream.ver = top.currentVersion;
        if(typeof(stream.source)!='undefined' && stream.source){
            stream.source_nam = getSourceMeta(stream.source, 'name');
            stream.source_len = getSourceMeta(stream.source, 'length');
            if(isNaN(parseInt(stream.source_len))){
                stream.source_len = -1; // -1 = unknown
            }
        }
    }
    return stream;
}

function playPrevious(){ // PCH
    var entry = History.get(0);
    var c = currentStream();
    if(entry){
        console.log('PLAYPREV', entry);
        if(c && entry.originalUrl == c.originalUrl){
            entry = History.get(1)
        }
        if(entry){
            playEntry(entry)
        }
    }
}

function testEntry(stream, success, error, returnSucceededIntent){
    var resolved = false, intents = [];
    if(isMagnet(stream.url) || isMega(stream.url) || isYT(stream.url)){
        success();
        return intents;
    }
    var checkr = () => {
        if(resolved) return;
        var worked = false, complete = 0, succeededIntent = null;
        for(var i=0; i<intents.length; i++){
            if(intents[i].started || intents[i].ended || intents[i].error){
                complete++;
            }
            if(!worked && intents[i].started && !intents[i].ended && !intents[i].error){
                if(returnSucceededIntent){
                    succeededIntent = intents[i];
                }
                worked = true;
            }
        }
        if(worked || complete == intents.length){
            resolved = true;
            for(var i=0; i<intents.length; i++){ // ready
                if(intents[i] != succeededIntent){
                    intents[i].destroy()
                }
            }   
            (worked ? success : error)(succeededIntent)
        }
    }
    intents = top.createPlayIntent(stream, {maxTimeout: 20, shadow: true, manual: false, start: checkr, error: checkr, ended: checkr});
    return intents;
}

var onlineUsersCount = "";
function updateOnlineUsersCount(){
    var callback = (n) => {
        var locale = getLocale(false, true);
        onlineUsersCount = Number(n).toLocaleString(locale) + ' ' + ( n==1 ? Lang.USER : Lang.USERS );
    }
    jQuery.getJSON('http://app.megacubo.net/stats/data/usersonline.json', (response) => {
        if(!isNaN(parseInt(response))){
            Store.set('usersonline', response);
            callback(response)
        }
    });
    var n = Store.get('usersonline');
    if(n){
        callback(n)
    }
}

var searchPath, bookmarksPath;
jQuery(document).on('lngload', () => {
    searchPath = Lang.EXTRAS+'/'+Lang.SEARCH;
    xtrasPath = Lang.EXTRAS;
    bookmarksPath = Lang.EXTRAS+'/'+Lang.BOOKMARKS;
    updateOnlineUsersCount();
    setInterval(updateOnlineUsersCount, 600000)
});

function nextLogoForGroup(element){
    var entry = jQuery(element).parents('a.entry');
    var data = entry.data('entry-data');
    if(data){
        if(data.entries){
            var src = element.src, found;
            for(var i=0; i<data.entries.length; i++){
                if(element.src == data.entries[i].logo) {
                    found = true;
                } else if(found){
                    if(data.entries[i].logo && (data.entries[i].logo != defaultIcons['stream'])){
                        element.src = data.entries[i].logo;
                        return;
                        break;
                    }
                }
            }
        }
        element.src = defaultIcons[data.type || 'group'];
    } else {
        element.src = defaultIcons['group'];
    }
}

function playResume(){
    if(!Config.get('resume')){
        return;
    }
    var entries = History.get();
    console.log(entries);
    if(entries.length){
        console.log('resume...');
        var i = 0;
        var events = {
			start: function (){
				console.log('RESUME SUCCESS '+document.URL)
			},
			error: function (){
                console.log('RESUME ERROR '+document.URL);
                /*
                if(top){
                    if(!top.PlaybackManager.query({error: false, ended: false}).length){
                        i++;
                        if(i <= entries.length){
                            top.createPlayIntent(entries[i], events);
                            return true;
                        } else {
                            console.log('No more history entries to resume.');
                        }
                    } else {
                        console.log('RESUME INTERRUPTED, ALREADY PLAYING');
                        return;
                    }
                }
                */
			}
        };
        if(!top.PlaybackManager.query({error: false, ended: false}).length){
            console.log(i);
            console.log(entries[i]);
            top.createPlayIntent(entries[i], events)
        }
    } else {
        console.log('History empty.');
    }
}

var streamStateCache = Store.get('stream_state_caches') || {}, streamStateCacheTTL = (7 * (24 * 3600));

function streamCacheNormalizeURL(url){
    url = String(url);
    if(url.indexOf('%') != -1){
        var n;  
        try {
        	n = decodeURIComponent(url)
        } catch(e) {
    	    //console.warn(e, url)
        }
        if(n){
            url = n;
        }
    }
    if(url.indexOf('&amp;') != -1 && top && top.decodeEntities){
        url = top.decodeEntities(url);
    }
    if(url.indexOf(':80/') != -1){
        url.replace(':80/', '/')
    }
    return url.replace(':80/', '/')
}

function getStreamStateCache(_url, ttl){
    var url = streamCacheNormalizeURL((_url && typeof(_url) == 'object') ? _url.url : _url);
    if(typeof(streamStateCache[url])=='object' && streamStateCache[url] && typeof(streamStateCache[url].time)!='undefined' && time() < (streamStateCache[url].time + (ttl || streamStateCacheTTL))){
        return streamStateCache[url].state;
    }
    return null;
}

function setStreamStateCache(entry, state){
    var urls = [entry.url];
    if(entry.originalUrl && !isMega(entry.originalUrl)){
        urls.push(entry.originalUrl)
    }
    urls.forEach((url) => {
        streamStateCache[streamCacheNormalizeURL(url)] = {'state': state, 'time': time()};
        Store.set('stream_state_caches', streamStateCache)
    })
}

function playEntry(stream){
    collectListQueue(stream);
    stream.prependName = '';
    top.PlaybackManager.cancelLoading();
    top.createPlayIntent(stream, {manual: true});
    updateStreamEntriesFlags()
}

function updateStreamEntriesFlags(){

    if(!top) return; // top is undefined on NW.js unloading

    // offline streams
    var activeurls = [];
    if(stream = currentStream()){
        activeurls.push(stream.url);
        if(stream.originalUrl){
            activeurls.push(stream.originalUrl)
        }
    }

    // pending entries
    var loadingurls = top.PlaybackManager.isLoading(true);
    if(typeof(top.isPending)=='string'){
        loadingurls.push(top.isPending)
    }
    console.log(loadingurls, top.isPending);

    var doSort = allowAutoClean(listingPath);

    var fas = jQuery('.entry-stream'), autoCleaning = jQuery('.entry-autoclean').filter((i, e) => { 
        return e.innerHTML.indexOf('% ') != -1; 
    }).length, firstStreamOffset = false;
    fas = fas.each((i, element) => {
        if(doSort){
            let state = getStreamStateCache(element.href);
            if(state === false){
                // is offline?
                let e = jQuery(element), n = e.find('.entry-label');
                n.find('.stream-state').remove();
                n.prepend('<span class="stream-state"><i class="fas fa-thumbs-down" style="color: #8c0825;font-size: 90%;position: relative;top: 0px;"></i> </span>');
                e.addClass('entry-offline')
            } else if(state === true) {
                let e = jQuery(element), n = e.find('.entry-label');
                n.find('.stream-state').remove();
                n.prepend('<span class="stream-state"><i class="fas fa-thumbs-up" style="color: #03821f;font-size: 90%;position: relative;top: -1px;"></i></span> ');
                e.removeClass('entry-offline');
            } else if(autoCleaning) {
                let e = jQuery(element), n = e.find('.entry-label');
                n.find('.stream-state').remove();
                n.prepend('<span class="stream-state"><i class="fas fa-clock" style="color: #eee;font-size: 90%;position: relative;top: -1px;"></i></span> ');
                e.removeClass('entry-offline');
            }
        }
        if(activeurls.indexOf(element.href)!=-1){
            setEntryFlag(element, 'fa-play-circle')
        } else if(loadingurls.indexOf(element.href)!=-1){
            setEntryFlag(element, 'fa-circle-notch fa-spin')
        } else {
            setEntryFlag(element, '')
        }
    });
    if(doSort){
        sortEntriesByState(fas)
    }
}

function showWindowHandle(show){
    var e = document.getElementById('window-handle');
    if(e){
        e.style.display = show ? 'inline-block' : 'none';
        e.querySelector('a').title = Lang.RESTORE;
    }
    if(top){
        top.PlaybackManager.setRatio()
    }
}

var listEntryFocusOnMouseEnterTimer = 0;

function parseM3U8NameTags(name){
    if(name){
        var match, matches = name.match(new RegExp('\\[/?color([^\\]]*)\\]', 'gi'));
        if(matches){
            for(var i=0; i<matches.length; i++){
                match = matches[i]; 
                if(match.toLowerCase().indexOf('[color ')!=-1){console.log(match)
                    try{
                        color = match.match(new RegExp(' ([^\\]]*)\\]', 'i'))[1];
                    } catch(e) {
                        color = '';
                    }
                    name = name.replaceAll(match, color ? '<font color="'+color+'">' : '')
                } else {
                    //console.log(match)
                    name = name.replaceAll(match, '</font>')
                }
            }
        }
        name = name.replace(new RegExp('\\[[^\\]]*\\]', 'g'), '').trim();
    }
    if(!name) {
        name = 'Untitled';
    }
    return name;
}

function getSources(){
    var key = 'sources';
    var r = false, sources = Config.get(key) || [];
    for(var i=0; i<sources.length; i++){
        if(!jQuery.isArray(sources[i])){
            delete sources[i];
            r = true;
        }
    }
    if(r){
        sources = sources.filter(function (item) {
            return item !== undefined && item !== null && item !== false;
        })
    }
    return sources;
}

function getSourcesURLs(){
    var urls = [];
    var sources = getSources();
    for(var i=0; i<sources.length; i++){
        urls.push(sources[i][1])
    }
    return urls;
}

function getNameFromSource(content){
    var match = content.match(new RegExp('(iptv|pltv)\\-name *= *[\'"]([^\'"]+)'));
    if(match){
        return match[2];
    }
}

function getNameFromSourceURL(url){
    url = url.replace(new RegExp('^[a-z]*://'), '').split('/');
    return (url[0].split('.')[0]+' '+url[url.length - 1]).replaceAll('?', ' ');
}

function getNameFromSourceURLAsync(url, callback){
    miniget(url, (err, object, response) => {
        var name = false;
        if(!err){
            name = getNameFromSource(response)
        }
        if(!name){
            name = getNameFromSourceURL(url)
        }
        callback(name, url, response)
    })
}

function checkStreamType(url, callback){
    var debug = true, domain = getDomain(url), tsM3u8Regex = new RegExp('\.(ts|m3u8?)([^A-Za-z0-9]|$)');
    if(['http', 'https', false].indexOf(getProto(url)) == -1){ // any other protocol like rtsp, rtmp...
        return callback(url, 'stream')
    }
    if(getExt(url)=='m3u'){
        return callback(url, 'list')
    }
    if(isMagnet(url) || isVideo(url) || isTS(url)){
        return callback(url, 'stream')
    }
    if(!isValidPath(url)){
        return callback(url, 'error')
    }
    var doCheck = function (response){
        var type = 'stream';
        if(response){
            if(response.indexOf('#EXT')!=-1){ // is m3u8
                response = String(response);
                response = ListMan.extract(response)
                if(debug){
                    console.log(response);
                }
                var eis = response.toUpperCase().split('#EXTINF:').length - 1; // EXTINFs
                var eiNDs = (response.toUpperCase().split('#EXTINF:0').length + response.toUpperCase().split('#EXTINF:-1').length) - 2; // EXTINFs with no duration
                console.log('CHECKSTREAMTYPE', eis, eiNDs);
                if(eis && eiNDs >= eis){
                    return callback(url, 'list')
                }
                var parser = getM3u8Parser();
                parser.push(response);
                parser.end();
                /*
                if(debug){
                    console.log('SEGMENT', parser.manifest);
                }
                */
                var u;
                if(parser.manifest && parser.manifest.segments){
                    for(var i=0;i<parser.manifest.segments.length;i++){
                        u = parser.manifest.segments[i].uri;
                        if(!u.match(tsM3u8Regex)){ // other format present, like mp4
                            return callback(url, 'list');
                            break;
                        }
                    }
                }
            }
        }
        callback(url, type)
    }
    if(url.match(new RegExp('^https?:'))){
        var timeout = 15000, fetchOptions = {redirect: 'follow', method: 'HEAD'};
        fetchTimeout(url, (r, ct) => {
            if(ct){
                if(ct && ct.indexOf('video')!=-1){
                    callback(url, 'stream')
                } else { // no valid content-type, fetch the whole content to check better
                    timeout = 30000, fetchOptions = {redirect: 'follow'};
                    fetchTimeout(url, (r) => {
                        if(r){
                            doCheck(r)
                        } else {
                            console.error('checkStreamType error', r);
                            callback(url, 'stream')
                        }
                    }, timeout, fetchOptions)
                }
            } else {
                console.error('checkStreamType error', r);
                callback(url, 'error')
            }
        }, timeout, fetchOptions)
    } else {
        fs.readFile(url, (err, response) => {
            if(err){
                console.error('checkStreamType error', err);
                callback(url, 'error')
            } else {
                doCheck(response)
            }
        })
    }
}

function addNewSource(){
    askForSource(Lang.PASTE_URL_HINT, (val) => {
        var url = val;
        console.log('CHECK', url);
        var n = notify(Lang.PROCESSING, 'fa-spin fa-circle-notch', 'wait');
        checkStreamType(url, (url, type) => {
            console.log('CHECK CALLBACK', url, type);
            n.close();
            if(type=='stream' && (isValidPath(url) || isMagnet(url))){
                playCustomURL(url, true)
            } else if(type=='list'){
                registerSource(url)
            } else {
                notify(Lang.INVALID_URL_MSG, 'fa-exclamation-circle', 'normal')
            }
        });
        return true;
    })
}

function registerSource(url, name, silent, norefresh){
    var chknam, key = 'sources';
    var sources = getSources();
    for(var i in sources){
        if(sources[i][1] == url){
            notify(Lang.LIST_ALREADY_ADDED, 'fa-exclamation-circle', 'normal');
            return false;
            break;
        }
    }
    if(!name){
        chknam = true;
        name = getNameFromSourceURL(url);
    }
    sources.push([name, url]);
    Config.set(key, sources);
    if(!silent){
        notify(Lang.LIST_ADDED, 'fa-star', 'normal');
    }
    setActiveSource(url);
    if(!norefresh){
        refreshListing()
    }
    if(chknam){
        getNameFromSourceURLAsync(url, (newName, url, content) => {
            if(newName != name){
                setSourceName(url, newName);
                if(!norefresh){
                    refreshListing()
                }
            }
        })
    }
    return true;
}

function setSourceName(url, name){
    var key = 'sources';
    var sources = getSources();
    for(var i in sources){
        if(sources[i][1] == url){
            sources[i][0] = name;
            break;
        }
    }
    Config.set(key, sources);
    return true;
}

function setSourceMeta(url, key, val){
    var sources = getSources();
    for(var i in sources){
        if(sources[i][1] == url){
            var obj = sources[i][2] || {};
            obj[key] = val;
            sources[i][2] = obj;
            Config.set('sources', sources);
            if(key == 'length' && url == getActiveSource()){
                var locale = getLocale(false, true);
                updateRootEntry(Lang.IPTV_LISTS, {label: Number(val).toLocaleString(locale)+' '+Lang.STREAMS.toLowerCase()});
                if(listingPath.length < 2){ // ishome
                    refreshListing()
                }
            }
        }
    }
}

function getSourceMeta(url, key){
    var sources = getSources();
    for(var i in sources){
        if(sources[i][1] == url){
            var obj = sources[i][2] || {};
            return obj[key] || null;
        }
    }
}

function unRegisterSource(url){
    var key = 'sources';
    var sources = Config.get(key);
    if(typeof(sources)!='object'){
        sources = [];
    }
    for(var i in sources){
        if(!jQuery.isArray(sources[i]) || sources[i][1] == url){
            delete sources[i];
        }
    }
    sources = sources.filter(function (item) {
        return item !== undefined;
    });
    Config.set(key, sources);
    notify(Lang.LIST_REMOVED, 'fa-trash', 'normal')
    return sources;
}

function getActiveSource(){
    var sources = getSourcesURLs();
    if(!sources.length){
        return false
    }
    return sources[0];
}

function setActiveSource(url){
    var skey = 'sources';
    var sources = Config.get(skey);
    if(!jQuery.isArray(sources)){
        sources = [];
    }
    var entry = [getNameFromSourceURL(url), url];
    for(var i=0;i<sources.length; i++){
        if(!jQuery.isArray(sources[i])){
            delete sources[i];
        } else if(entry[1] == sources[i][1]){
            entry[0] = sources[i][0];
            delete sources[i];
        }
    }
    console.log('SETACTIVE', entry);
    sources.unshift(entry);
    Config.set(skey, sources);
    markActiveSource()
}

function priorizeEntries(entries, filter){
    var goodEntries = [], badEntries = [], neutralEntries = [];
    entries.forEach((entry) => {
        var s = filter(entry);
        if(s === true){
            goodEntries.push(entry)
        } else if(s === false){
            badEntries.push(entry)
        } else {
            neutralEntries.push(entry)
        }
    });
    return goodEntries.concat(neutralEntries).concat(badEntries)
}

function sortEntries(entries, filter){
    if(entries.length){
		return entries.sort(filter)
    }
    return entries;
}

function sortEntriesStateKey(entry, historyData, watchingData){
    var state = entry ? getStreamStateCache(entry) : null, inHistory = false, inWatching = false;
    for(var i=0; i<historyData.length; i++){
        if(historyData[i].url == entry.url){
            inHistory = true;
            break;
        }
    }
    if(!inHistory){
        for(var i=0; i<watchingData.length; i++){
            if(watchingData[i].url && watchingData[i].url == entry.url){
                inWatching = true;
                break;
            }
        }
    }
    return ((state === true) ? 0 : (state === false ? 2 : 1)) + '-' + (inHistory ? 0 : (inWatching ? 1: 2)) + '-' + (isTS(entry.url) ? 1 : 0) + '-' + (entry.name || '').toLowerCase();
}

function sortEntriesByState(entries){
    var historyData = History.get(), watchingData = getWatchingData();
    if(entries instanceof jQuery){
        entries.each((i, o) => {
            let j = jQuery(o);
            if(j.length){
                entry = j.data('entry-data');
                if(entry){
                    j.data('sortkey', sortEntriesStateKey(entry, historyData, watchingData))
                }
            }
        });
        var p = entries.eq(0).prev(), type = 'after'; 
        if(!p.length){
            p = entries.eq(0).parent();
            type = 'prepend';
        }
        entries.detach().sort((a, b) => {
            var c = $(a).data('sortkey');
            var d = $(b).data('sortkey');
            return c > d ? 1 : -1;
        });   
        if(type == 'after'){
            entries.insertAfter(p)
        } else {
            p.prepend(entries)
        }
    } else {
        if(entries.sortBy){
            for(var i=0; i<entries.length; i++){
                if(entries[i]){
                    entries[i].sortkey = sortEntriesStateKey(entries[i], historyData, watchingData)
                }
            }
            return entries.sortBy('sortkey')
        }
    }
    return entries;
}

var autoCleanEntriesQueue = [], closingAutoCleanEntriesQueue = [], autoCleanEntriesStatus = '';

function autoCleanEntries(entries, success, failure, cancelCb, returnSucceededIntent){
    if(autoCleanEntriesCancel()){
        jQuery('a.entry-autoclean .entry-name').html(Lang.TEST_THEM_ALL)
    }
    var succeeded = false, readyIterator = 0, debug = true;
    if(!jQuery.isArray(entries)){
        var arr = [];
        jQuery('a.entry-stream').each((i, o) => {
            var e = jQuery(o).data('entry-data');
            if(e){
                arr.push(e)
            }
        });
        entries = sortEntriesByState(arr);
    }
    if(!entries.length){
        if(typeof(failure)=='function'){
            setTimeout(failure, 150)
        }
        return false;
    }
    console.log('autoCleanSort', entries);
    console.log('autoCleanSort', entries.map((entry) => {return entry.sortkey+' ('+entry.url+')'}).join(", \r\n"));
    var controller, iterator = 0;
    autoCleanEntriesStatus = Lang.AUTOCLEAN+' 0% ('+readyIterator+'/'+entries.length+')';
    jQuery('a.entry-autoclean .entry-name').html(autoCleanEntriesStatus);
    controller = {
        testers: [],
        cancelled: false,
        id: time(),
        cancel: () => {
            if(!controller.cancelled){
                if(debug){
                    console.warn('ACE CANCEL', tasks.length, controller.id)
                }
                console.log('cancelling', controller.testers);
                controller.cancelled = true;
                controller.testers.forEach((intent, i) => {
                    if(intent.shadow){ // not returned onsuccess
                        try {
                            intent.destroy();
                        } catch(e) {
                            console.warn(e)
                        }
                    }
                });
                autoCleanEntriesStatus = '';
                jQuery('a.entry-autoclean .entry-name').html(Lang.TEST_THEM_ALL);
                if(!succeeded && typeof(cancelCb)=='function'){
                    cancelCb()
                }
                autoCleanEntriesRunning() // purge invalid controllers on ac queue
            }
        }
    }
    var tasks = Array(entries.length).fill((callback) => {
        if(controller.cancelled){
            callback();
            return;
        }
        var entry = entries[iterator], originalUrl = entry.url;
        iterator++;
        if(isMagnet(entry.url) || isMega(entry.url)){
            readyIterator++;
            if(debug){
                console.warn('ACE k')
            }
            return callback() // why should we test?
        }
        if(debug){
            console.log('ACE TESTING', entry.name, entry.url, entry, entries, controller.id)
        }
        try {
            var originalUrl = entry.originalUrl && !isMega(entry.originalUrl) ? entry.originalUrl : entry.url, ntesters = testEntry(entry, (succeededIntent) => {
                if(!top){
                    controller.cancel()
                } else if(controller.cancelled){
                    if(succeededIntent){
                        succeededIntent.destroy()
                    }
                    return callback()
                } else {
                    if(debug){
                        console.warn('ACE TESTING SUCCESS', returnSucceededIntent, succeededIntent, entry.name, entry.url, succeeded, controller.cancelled)
                    }
                    readyIterator++;
                    if(!succeeded){
                        succeeded = true;
                        if(succeededIntent){
                            succeededIntent.shadow = false;
                        }
                        if(returnSucceededIntent){
                            controller.cancel()
                            if(debug){
                                console.warn('ACE TESTING CANCEL', entry.name, entry.url, succeeded, controller.cancelled, controller.id)
                            }
                        }
                        if(typeof(success)=='function'){
                            console.warn('ACE SUCCES CB', entry.name, entry.url, succeededIntent)
                            success(entry, controller, succeededIntent)
                        }
                    }
                    autoCleanEntriesStatus = Lang.AUTOCLEAN+' '+parseInt(readyIterator / (entries.length / 100))+'% ('+readyIterator+'/'+entries.length+')';
                    jQuery('a.entry-autoclean .entry-name').html(autoCleanEntriesStatus);
                    setStreamStateCache(entry, true);
                    updateStreamEntriesFlags();
                    top.sendStats('alive', sendStatsPrepareEntry(entry));
                    callback();
                }
            }, () => {
                if(!top){
                    controller.cancel()
                } else if(controller.cancelled){
                    if(succeededIntent){
                        succeededIntent.destroy()
                    }
                    return callback()
                } else {
                    if(debug){
                        console.warn('ACE TESTING FAILURE', entry.name, entry.url, succeeded, controller.cancelled, controller.id)
                    }
                    readyIterator++;
                    autoCleanEntriesStatus = Lang.AUTOCLEAN+' '+parseInt(readyIterator / (entries.length / 100))+'% ('+readyIterator+'/'+entries.length+')';
                    jQuery('a.entry-autoclean .entry-name').html(autoCleanEntriesStatus);
                    setStreamStateCache(entry, false);
                    updateStreamEntriesFlags();
                    callback();
                    if(debug){
                        console.warn('ACE F')
                    }
                    top.sendStats('error', sendStatsPrepareEntry(entry))
                }
            }, returnSucceededIntent);
            console.log('ACE G', ntesters, entry);
            if(jQuery.isArray(ntesters)){
                console.log('ACE H', controller.testers, ntesters);
                controller.testers = controller.testers.concat(ntesters)
            }
        } catch(e) {
            console.error('ACE', e)
        }
        if(debug){
            console.warn('ACE 2', controller.testers)
        }
    });
    console.log('ACE I', controller.testers);
    autoCleanEntriesQueue.push(controller);
    setTimeout(() => {
        if(typeof(async) == 'undefined'){
            async = require('async')
        }
        async.parallelLimit(tasks, 3, (err, results) => {
            console.warn('ACE DONE', tasks.length);
            if(!controller.cancelled){
                controller.cancel();
                if(!succeeded && typeof(failure)=='function'){
                    setTimeout(failure, 150)
                }
                autoCleanEntriesStatus = Lang.AUTOCLEAN+' 100%';
                jQuery('a.entry-autoclean .entry-name').html(autoCleanEntriesStatus);
            }
        })
    }, 100);
    return controller;
}

function autoCleanEntriesRunning(){
    for(var i=0; i<autoCleanEntriesQueue.length; i++){
        if(autoCleanEntriesQueue[i] && autoCleanEntriesQueue[i].cancelled){
            closingAutoCleanEntriesQueue.push(autoCleanEntriesQueue[i])
            autoCleanEntriesQueue[i] = null;
        }
    }
    autoCleanEntriesQueue = autoCleanEntriesQueue.filter((item) => {
        return !!item
    });
    return !!autoCleanEntriesQueue.length;
}

function autoCleanEntriesCancel(){
    var cancelled = false;
    if(autoCleanEntriesQueue.length){
        console.warn('AUTOCLEAN CANCEL', autoCleanEntriesQueue, traceback());
        closingAutoCleanEntriesQueue = closingAutoCleanEntriesQueue.concat(autoCleanEntriesQueue);
        autoCleanEntriesQueue = [];
        for(var i=0; i<closingAutoCleanEntriesQueue.length; i++){
            console.log(closingAutoCleanEntriesQueue[i]);
            if(closingAutoCleanEntriesQueue[i]){
                closingAutoCleanEntriesQueue[i].cancel()
            }
        }
        autoCleanEntriesStatus = '';
    }
    return cancelled;
}

function areControlsIdle(){
    return jQuery('body').hasClass('idle')
}

function defaultParentalControlTerms(){
    var terms = Config.get('default-parental-control-terms');
    if(typeof(terms)!='string'){
        terms = 'adult,erotic,erótic,sex,porn';
    }
    return fixUTF8(terms).toLowerCase().split(',').filter((term) => {
        return term.length >= 2;
    })
}

function userParentalControlTerms(){
    var sepAliases = ['|', ' '];
    var terms = Config.get('parental-control-terms');
    if(typeof(terms)!='string'){
        terms = '';
    }
    sepAliases.forEach((sep) => {
        terms = terms.replaceAll(sep, ',')
    });
    return terms.toLowerCase().split(',').filter((term) => {
        return term.length >= 2;
    })
}

function parentalControlTerms(){
    return userParentalControlTerms().concat(defaultParentalControlTerms())
}

var showAdultContent = Config.get('show-adult-content');
function parentalControlAllow(entry, ignoreSetting){
    if(showAdultContent && !ignoreSetting){
        return true;
    }
    var terms = parentalControlTerms();
    if(typeof(entry)=='string'){
        return !hasTerms(entry, terms);
    }
    if(entry && typeof(entry.type)=='string' && ['group', 'stream'].indexOf(entry.type)==-1){
        return true;
    }
    if(terms.length){
        if(typeof(entry.name)=='string' && hasTerms(entry.name, terms)){
            return false;
        }
        //if(typeof(entry.url)=='string' && hasTerms(entry.url, terms)){
        //    return false;
        //}
        if(typeof(entry.label)=='string' && hasTerms(entry.label, terms)){
            return false;
        }
        if(typeof(entry.group)=='string' && hasTerms(entry.group, terms)){
            return false;
        }
    }
    return true;
}

function toggleControls(){
    if(areControlsActive()){
        hideControls()
    } else {
        showControls()
    }
}

function parentalControlMatchPalette(colors){
    // 78 13 0
    // 232 214 212
    // dentro dessa range com oscilação máxima entre o RGB de 78 pontos e com o vermelho sempre maior e o azul menor
    var r, g, b, skinHits = 0;
    for(var i=0; i<colors.length; i++){
        r = colors[i][0];
        g = colors[i][1];
        b = colors[i][2];
        if(r > 75 && r > g && g > b){
            if(Math.abs(r - b) < 100 && Math.abs(r - g) > 12){
                skinHits++;
            }
        }
    }
    // console.log('SKINHITS', skinHits, colors.length, Math.ceil(colors.length / 3));
    return skinHits >= 3;
}

/*
var colorThief = false;
function parentalControlAllowImage(image){ // fa-ban
    if(!colorThief){
        var o = getFrame('overlay');
        if(!o) return true;
        colorThief = new (o.ColorThief)();
    }
    var colors = colorThief.getPalette(image, 16);
    if(!jQuery.isArray(colors) || colors.length < 10){
        return false;
    }
    return !parentalControlMatchPalette(colors)
}

function parentalControlAllowImageURL(url, callback){ // fa-ban
    var m = new Image();
    m.onload = () => {
        callback(parentalControlAllowImage(m), url)
    }
    m.onerror = () => {
        callback(true, url)
    }
    m.src = url;
}
*/

function hasTerms(stack, needles){
    if(stack.length > 2){
        stack = stack.toLowerCase();
        for(var i=0; i<needles.length; i++){
            if(needles[i].length && stack.indexOf(needles[i])!=-1){
                return true;
            }
        }
    }
    return false;
}

var focusEntryItem, lastTabIndex = 1, controlsTriggerTimer = 0, isScrolling = false, scrollEnd, isTyping = false, typingEnd, isWheeling = false, wheelEnd, handleMenuFocus, scrollDirection;

jQuery(function (){
    var t = 0, x, tb = jQuery(top.document).find('body'), c = tb.find('iframe#controls'), d = jQuery('div#controls'), b = jQuery('body'), l = jQuery(".list"), ld = l.find("div:eq(0)");

    focusEntryItem = (a, noscroll) => {
        console.log(a.length, a.html());
        if(!noscroll){
            let y = a.offset().top + l.scrollTop(), ah = a.height();
            //console.log(a.html(), y);
            l.scrollTop(y - ((l.height() - ah) / 2))
        }
        jQuery('.entry-focused').removeClass('entry-focused');
        a.addClass('entry-focused').trigger('focus')
    }
        
    /* scrollstart|scrollend events */
    scrollEnd = () => {
        isScrolling = false;
        b.trigger("scrollend")
    }
    jQuery(".list").on("scroll", () => {
        if(isScrolling){
            clearTimeout(isScrolling)
        } else {
            b.trigger("scrollstart")
        }
        isScrolling = setTimeout(scrollEnd, 400)
    });

    /* wheelstart|wheelend events */
    wheelEnd = () => {
        isWheeling = false;
        b.trigger("wheelend")
    }
    jQuery(".list").on("wheel", () => {
        if(isWheeling){
            clearTimeout(isWheeling)
        } else {
            b.trigger("wheelstart")
        }
        isWheeling = setTimeout(wheelEnd, 400)
    });

    /* typestart|typeend events */
    typingEnd = () => {
        isTyping = false;
        b.trigger("typeend")
    }
    b.on("keydown", () => {
        if(isTyping){
            clearTimeout(isTyping)
        } else {
            b.trigger("typestart")
        }
        isTyping = setTimeout(typingEnd, 400)
    });

    /* adjust focus to visible items always */
    var lastScrollY = 0;
    handleMenuFocus = () => {
        var newScrollY = l.scrollTop();
        scrollDirection = (lastScrollY > newScrollY) ? 'up' : 'down';
        lastScrollY = newScrollY;
        if(document.activeElement){
            var tag = document.activeElement.tagName.toLowerCase();
            if(['a', 'input'].indexOf(tag)!=-1){ // focus a.entry or input (searching) only
                lastTabIndex = document.activeElement.tabIndex;
                /*
                if(tag == 'input'){
                    tb.addClass('showcontrols') // istyping 
                } else {
                    tb.removeClass('istyping')
                }
                */
            }
        } else {
            /*
            tb.removeClass('istyping')
            */
        }
    }   
    jQuery(window).on('resize', handleMenuFocus);

    console.log(b);
    b.on('scrollend', () => {
        var y = jQuery('.list').scrollTop();
        if(y >= 500){
            b.addClass('scrolled_500')
        } else {
            b.removeClass('scrolled_500')
        }
    })
    console.log(b);

    /* ignore focus handling while scrolling, with mouse or keyboard */
    (() => {
        var unlockDelay = 0;
        var lock = () => { 
            ld.css("pointer-events", "none") 
        }
        var unlock = () => { 
            ld.css("pointer-events", "all");
            handleMenuFocus()
        }
        var unlocker = () => { 
            clearTimeout(unlock);
            unlockDelay = setTimeout(unlock, 400)
        }
        b.on("wheelstart", lock).on("wheelend", unlocker).on("typestart", lock).on("typeend", unlocker).on("blur", "a", handleMenuFocus);
    })()
})

jQuery(window).one('unload', function (){
    top.sendStats('die')
})

jQuery(document).one('show', () => {
    jQuery.getJSON('http://app.megacubo.net/configure.json?'+time(), (data) => {
        if(!data || !data.version) return;
        var currentVersion = data.version;
        if(typeof(data.adultTerms)!='undefined'){
            if(typeof(data.adultTerms) != 'string'){
                data.adultTerms = String(data.adultTerms)
            }   
            Config.set('default-parental-control-terms', fixUTF8(data.adultTerms), 30 * (24 * 3600))
        }
        getManifest((data) => {
            console.log('VERSION', data.version, currentVersion);
            top.currentVersion = data.version;
            jQuery('#home-icons a, #list-icons a').each((i, element) => {
                var je = jQuery(element), key = je.attr('data-title-lng-key');
                if(key && Lang[key]){
                    je.attr('title', Lang[key])
                }
            });
            jQuery('#home-icon-help').attr('title', 'Megacubo v'+top.currentVersion);
            if(data.version < currentVersion){
                jQuery('#home-icon-help').html('<i class="fas fa-bell" aria-hidden="true"></i>').css('color', '#ff6c00');
                if(confirm(Lang.NEW_VERSION_AVAILABLE)){
                    gui.Shell.openExternal('https://megacubo.tv/online/?version='+data.version);
                }
            }
        })
    })
})

var listingPath = ltrimPathBar(Store.get('listingPath')) || '', autoCleanHintShown = false, pos = listingPath.indexOf(Lang.MY_LISTS);
if(pos == -1 || pos > 3){
    listingPath = '';
}
jQuery(window).on('unload', function (){
    Store.set('listingPath', listingPath)
})

function queryEntries(entries, atts, remove){
    var results = [];
    for(var i in entries){
        for(var key in atts){
            if(typeof(entries[i][key])=='undefined'){
                continue;
            } else if(typeof(entries[i][key])=='function'){
                if(entries[i][key](entries[i]) == atts[key]){
                    results.push(entries[i]);
                    if(remove){
                        delete entries[i];
                    }
                }
            } else {
                if(entries[i][key] == atts[key]){
                    results.push(entries[i]);
                    if(remove){
                        delete entries[i];
                    }
                }
            }
        }        
    }
    if(remove){
        return entries.slice(0) // reset
    }
    return results;
}

function removeEntries(entries, atts){
    return queryEntries(entries, atts, true)
}

function pickLogoFromEntries(entries, type){
    if(!type){
        type = 'stream';
    }
    var rgx = new RegExp('( |fa\-)');
    for(var i in entries){
        if(entries[i].logo && !entries[i].logo.match(rgx)){
            return entries[i].logo;
        }
    }
    return defaultIcons[type];
}

function autoCleanNPlay(entries, name, originalUrl){
    if(typeof(entries)=='string'){
        if(!name){
            name = entries;
        }
        var nentries = fetchSharedListsSearchResults('stream', entries, true);
        if(nentries.length == 1 && nentries[0].type=='option'){ // search index not ready
            return setTimeout(() => {
                autoCleanNPlay(entries, name, originalUrl)
            }, 500)
        }
        entries = nentries;
    }
    var failure = () => {
        notify(Lang.PLAY_STREAM_FAILURE.format(name), 'fa-exclamation-circle', 'normal');
    }
    if(!entries.length){
        failure();
        return;
    }
    if(!name){
        name = entries[0].name;
    }
    if(autoCleanEntriesRunning()){
        autoCleanEntriesCancel()
    }
    //console.warn('ORDERED', entries);
    var hr = autoCleanEntries(entries, (entry, controller, succeededIntent) => {
        leavePendingState();
        console.warn('ACE TES SUCCESS', entry, controller, succeededIntent);
        var title = Lang.CONNECTING+': '+(decodeURIComponent(entry.name) || entry.name);
        enterPendingState(title, Lang.CONNECTING, originalUrl);
        controller.cancel();
        notifyRemove(Lang.TUNING);
        console.log('preAutoCleanNPlay success', succeededIntent, entry);
        if(originalUrl){
            entry.originalUrl = originalUrl;
        }
        console.log('autoCleanNPlay success', succeededIntent, entry);
        if(succeededIntent) {
            succeededIntent.manual = true;
            succeededIntent.shadow = false;
            succeededIntent.entry = entry;
            top.PlaybackManager.commitIntent(succeededIntent)
        } else {
            playEntry(entry)
        }
        setTimeout(refreshListing, 500)
    }, () => {
        console.warn('FAILED');
        leavePendingState();
        failure()
    }, () => {
        console.warn('CANCELLED');
        leavePendingState()
    }, true);
    if(hr){
        var title = Lang.TUNING+': '+(decodeURIComponent(name) || name);
        enterPendingState(title, Lang.TUNING, originalUrl);
        return true;
    }
    return;
}

function getMainCategoriesEntries(){
    var category, optionName = Lang.CHANNELS;
    return fetchAndRenderEntries("http://app.megacubo.net/stats/data/categories."+getLocale(true)+".json", optionName, (category) => {
        category.entries = category.entries.map((entry) => {
            entry.type = 'group';
            entry.renderer = (data) => {
                //console.warn(data);
                var entries = fetchSharedListsSearchResults('stream', data.name, true);
                if(!entries.length){
                    notify(Lang.PLAY_STREAM_FAILURE.format(data.name), 'fa-exclamation-circle', 'normal');
                    return -1;
                }
                entries = listManJoinDuplicates(entries);
                var sbname = Lang.STREAMS+': '+entries.length, megaUrl = 'mega://play|' + encodeURIComponent(data.name);
                var watchEntries = [
                    {type: 'stream', name: data.name, logo: pickLogoFromEntries(entries), label: '<i class="fas fa-play-circle"></i> '+Lang.WATCH_NOW, url: megaUrl, callback: () => {
                        autoCleanNPlay(entries, data.name, megaUrl)
                    }},
                    {type: 'group', name: Lang.OPTIONS, label: sbname, logo: 'fa-list', path: assumePath(sbname), entries: [], renderer: () => {
                        entries = entries.map((entry) => { 
                            // entry.originalUrl = megaUrl; // why?!
                            return entry; 
                        });
                        //console.warn(entries);
                        return entries;
                    }}
                ];
                var bookmarking = {name: data.name, type: 'stream', label: data.group || '', url: megaUrl};
                if(Bookmarks.is(bookmarking)){
                    watchEntries.push({
                        type: 'option',
                        logo: 'fa-star-half',
                        name: Lang.REMOVE_FROM.format(Lang.BOOKMARKS),
                        callback: () => {
                            removeFav(bookmarking);
                            refreshListing()
                        }
                    })
                } else {
                    watchEntries.push({
                        type: 'option',
                        logo: 'fa-star',
                        name: Lang.ADD_TO.format(Lang.BOOKMARKS),
                        callback: () => {
                            addFav(bookmarking);
                            refreshListing()
                        }
                    })
                }
                return watchEntries;
            }
            if(!entry.logo){
                entry.logo = defaultIcons['stream'];
            }
            return entry;
        });
        return category;
    }, (entries) => {
        entries.unshift({name: Lang.IPTV_LISTS, label: Lang.MY_LISTS, logo:'fa-list', type: 'group', entries: [], renderer: getListsEntries});
        entries.unshift({name: Lang.BEEN_WATCHED, logo: 'fa-users', label: onlineUsersCount, type: 'group', renderer: getWatchingEntries, entries: []});
        return entries;
    })
}

jQuery(document).one('lngload', function (){
    window.index = [
        {name: Lang.CHANNELS, label: Lang.CATEGORIES, logo:'assets/icons/white/tv.png', type: 'group', entries: [], renderer: getMainCategoriesEntries},
        {name: Lang.EXTRAS, label: Lang.IPTV_LISTS+' &middot; '+Lang.RECORDINGS, logo:'fa-th-large', type: 'group', entries: [], renderer: getXtraEntries, callback: appendRemoteXtras},
        {name: Lang.OPTIONS, logo:'assets/icons/white/settings.png', url:'javascript:;', type: 'group', entries: [
            {name: Lang.OPEN_URL+' (Ctrl+U)', logo:'fa-link', type: 'option', callback: () => {playCustomURL()}},
            {name: Lang.WINDOW, logo:'fa-window-maximize', type: 'group', renderer: getWindowModeEntries, entries: []},
            {name: Lang.LANGUAGE, logo:'fa-language', type: 'group', renderer: getLanguageEntries, callback: markActiveLocale, entries: []},
            {name: Lang.PARENTAL_CONTROL, logo: 'assets/icons/white/parental-control.png', type: 'group', renderer: getParentalControlEntries, entries: []},
            {name: Lang.SEARCH_RANGE, logo: 'fa-search', type: 'group', renderer: getSearchRangeEntries, entries: [], callback: () => {
                var entries = jQuery('a.entry-option'), range = Config.get('search-range') || 18;
                entries.each((i) => {
                    var el = entries.eq(i);
                    if(el.data('entry-data').value == range){
                        setEntryFlag(el, 'fa-check-circle')
                    }
                })
            }},
            {name: Lang.RESUME_PLAYBACK, type: 'check', check: (checked) => {Config.set('resume',checked)}, checked: () => {return Config.get('resume')}},
            {name: Lang.HIDE_BUTTON_OPT.format(Lang.BACK, 'Backspace'), type: 'check', check: (checked) => {Config.set('hide-back-button',checked)}, checked: () => {return Config.get('hide-back-button')}},
            {name: Lang.RESET_DATA, logo:'fa-trash', type: 'option', renderer: top.resetData, entries: []},
        ]}
    ];
    
    console.log(getSources());
    if(!getSources().length){
        registerSource(communityList(), Lang.COMMUNITY_LIST, true);
    }

    setTimeout(() => {
        if(!top.PlaybackManager.intents.length){
            playResume()
        }
    }, 1000)
    
    if(listingPath){
        var l = false;
        try{
            l = readIndexPath(listingPath)
        }catch(e){
            console.error(e)
        }
        if(!l || !l.length){
            listingPath = '';
        }
    } else {
        listingPath = '';
    }

    listEntriesByPath(listingPath);
    setTimeout(() => {}, 0); // tricky?!
    //console.log(jQuery('.list').html())

    setTimeout(function (){
        jQuery(document).trigger('show');
        if(top){
            centralizedResizeWindow(top.initialSize().width, top.initialSize().height);
            jQuery(top.document).find('#splash').hide();
            top.jQuery(top.document).trigger('show');
            top.enableSetFullScreenWindowResizing = true;
        }
        showControls();
    }, 2000)
})

