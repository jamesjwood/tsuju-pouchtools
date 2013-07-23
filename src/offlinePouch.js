
var utils = require('utils');
var async = require('async');
var events = require('events');
var replicator = require('./replicator.js');

var url = require('url');

var pouch;

if(typeof window === 'undefined')
{
	pouch = require('pouchdb');
} 
else
{
	pouch = Pouch;
}


module.exports = function(url, opts, log, callback){

	var retryDelay = opts.retryDelay || 5000;
	var waitForInitialReplicate = true;
	if(typeof opts.waitForInitialReplicate !== undefined)
	{
		waitForInitialReplicate = opts.waitForInitialReplicate;
	}

	var filter = opts.filter;

	var retries = -1; // infinate retries

	var activeDB;
	var serverDB;
	var localDB;

	var setActiveDB = function(db, location){
		if(db !== activeDB)
		{
			activeDB = db;
			if(location === 'local')
			{
				module.exports.setLocalDBCreated(url);
			}
			setLocation(location);
		}

	};

	var that = new events.EventEmitter();

	var mapped = ['put', 'post', 'get', 'allDocs', 'changes', 'bulkDocs'];
	mapped.map(function(name){
		that[name] = function(){
			activeDB[name].apply(this, arguments);
		};
	});

	that.close = function(){
		if(that.replicator)
		{
			that.replicator.cancel();
		}
		that.removeAllListeners();
		if(serverDB)
		{
			serverDB.close();
		}
		if(localDB)
		{
			localDB.close();
		}
	};
	that.location = '';
	that.status = 'initializing';
	var setLocation = function(location){
		if(that.location !== location)
		{
			that.location = location;
			that.emit('locationChanged', location);
		}
	};
	if(!module.exports.offlineSupported())
	{
		retries = 0;
		log('no browser support for local data, returning serverdb');
		module.exports.getServerDb(pouch, url, retries, retryDelay, log.wrap('getting serverdb'),  utils.cb(callback, function(sdb){
			serverDB = sdb;
			setActiveDB(serverDB, 'server');
			callback(null, that);
		}));
		return;
	}
	log('browser supports local data');


	var runLog = utils.log(that);

	var setReplicator = function(replicatior){
		that.replicator = replicatior;
		replicator.on('upToDate', function(a){
			that.emit('upToDate', a);
		});
		replicator.on('initialReplicateComplete', function(a){
			that.emit('initialReplicateComplete', a);
		});

		var replicatorLog = runLog.wrap('replicator');
		utils.log.emitterToLog(replicator, replicatorLog);
	};

	var replicationSetupError = function(error){
		that.emit('log', 'replication setup error');
		that.emit('error', error);
	};


	if(module.exports.localDBAlreadyCreated(url) === true)
	{
		log('local data already created');
		module.exports.getLocalDb(pouch,url, utils.cb(callback, function(ldb){
			localDB = ldb;
			setActiveDB(localDB, 'local');
			retries = -1;
			module.exports.getServerDb(pouch,url, retries, retryDelay,  log.wrap('getting serverdb'), utils.cb(replicationSetupError, function(sdb){
				serverDB= sdb;
				setReplicator(replicator(localDB, serverDB, {filter: filter}));
			}));
			callback(null, that);
		}));
	}
	else
	{
		log('local data not already created');
		module.exports.getLocalDb(pouch, url, log.wrap('get local db'),utils.cb(callback, function(ldb){
			localDB = ldb;
			if(waitForInitialReplicate === false)
			{
				log('not waiting for initial replication, db ready to use');
				setActiveDB(localDB, 'local');
				callback(null, that);
			}
			else
			{
				log('waiting for initial replication');
				retries = 10;
			}

			module.exports.getServerDb(pouch, url, retries, retryDelay, log.wrap('getting serverdb'), utils.cb(callback, function(sdb){
				serverDB = sdb;
				if(waitForInitialReplicate === true)
				{
					setActiveDB(serverDB, 'server');
					callback(null, that);
				}
				replicator = replicator(localDB, serverDB, {filter: filter});
				setReplicator(replicator);
				replicator.on('initialReplicateComplete', utils.cb(replicationSetupError, function(){
					setActiveDB(localDB, 'local');
					setLocation('local');
				}));
			}));
		}));
	}
};


module.exports.getServerDb = function(pouchdb, url, retries, retryDelay, log, callback){
	utils.safe(callback, function(){
		var ret  = retries;
		log('pouch get db: ' + url);
		pouchdb(url, utils.safe(callback, function(error, db){
			if(error)
			{
				if(error.status === 400)
				{
					//timeout or not available
					log.error(error);
					log('failed to get pouch');
					if(retries ===0)
					{
						callback(error);
					}
					else
					{
						log('retrying in ' + retryDelay + ' milliseconds');
						setTimeout(function(){
							module.exports.getServerDb(pouchdb,url, retries-1, retryDelay, log, callback);
						}, retryDelay);
					}
					return;
				}
				callback(error);
			}
			log('pouch found');
			callback(null, db);
		}));
	})();
};


module.exports.getLocalDb = function(pouchdb, serverUri, log, callback){

	var serverURL = url.parse(serverUri);

	utils.safe(callback, function(){
		var localDBName = serverURL.hostname + "-" + serverURL.port + "-" + serverURL.pathname.replace('/', '');
		if(typeof window === 'undefined')
		{
			localDBName = 'stage/' + localDBName;
		}
		log('getting local db: ' + localDBName);
		pouchdb(localDBName, utils.cb(callback, function(db){
			callback(null, db);
		}));
	})();
};



module.exports.offlineSupported = function(){
	if(!window)
	{
		//node, use levelDB
		return true;
	}
	if (window.indexedDB || window.openDatabase) {
		return true;
	}
	else
	{
		return false;
	}
};

module.exports.setLocalDBCreated = function(url){
	if(typeof window !== 'undefined')
	{
		core.createCookie(url, true);
	}
};
module.exports.localDBAlreadyCreated = function(url){
	var available;
	if(typeof window !== 'undefined')
	{
		available = core.readCookie(url);
	}
	else
	{
		available = false;
	}

	return (available === true);
};