var events = require('events');
var utils = require('utils');
var jsonCrypto = require('jsonCrypto');
var async = require('async');

module.exports =function(processor){
  var queue = {};

  var that = new events.EventEmitter();
  var log = utils.log(that);
  var processorLog = log.wrap('processor');


  that.cancelled = false;
  that.cancel = function(){
    that.cancelled = true;
    that.emit('cancelled');
    that.removeAllListeners();
  };

  var itemsBeingProcessed = [];
  var processing = false;
  var awaitingProcessing = false;
  that.offline = true;

  var setOffline= function(off){
    if(that.offline !== off)
    {
      that.offline = off;
      that.emit('offline', off);
    }
  };

  var allItemsProcesseed = function(orginalAsArray, updated){
    var all = true;
    if(Object.keys(updated).length === 0)
    {
      return all;
    }
    orginalAsArray.map(function(key){
      if(typeof updated[key] !== undefined)
      {
        all = false;
        return;
      }
    });
    return all;
  };

  that.doneProcessing = function(error){
    that.queued = Object.keys(queue).length;
    if(!that.cancelled)
    {
      if(error)
      {
        setOffline(true);
        log('error processing queue');
        that.emit('error', error);
        that.cancel();
        return;
      }
      that.emit('log', 'done processing');
      processing = false;

      if(allItemsProcesseed(itemsBeingProcessed, queue) === true)
      {
        setOffline(false);
        if(awaitingProcessing)
        {
          log('more added while processing');
          setTimeout(that.process, 0);
        }
        else
        {
          that.emit('state', 'idle');
        }
      }
      else
      {
        log('some items failed to process, scheduling a retry in 5 seconds');
        setOffline(true);
        setTimeout(that.process, 5000);
        that.emit('state', 'idle');
      }
    }
  };
  var itemProcessed = function(seq, a, b, c, d, e){
    log('raising item processed event');
    that.emit('itemProcessed', seq, a, b, c, d, e);
  };

  that.process = utils.safe.catchSyncronousErrors(that.doneProcessing, function(){
    if(!processing && !that.cancelled)
    {
      itemsBeingProcessed = Object.keys(queue);
      that.queued = itemsBeingProcessed.length;
      if(that.queued > 0)
      {
        that.emit('state', 'busy');
        log('initiating processing');
        awaitingProcessing = false;
        processing = true;
        log('calling process');
        utils.safe.catchSyncronousErrors(that.doneProcessing, processor)(queue, itemProcessed, processorLog, that.doneProcessing);
      }
      else
      {
        that.doneProcessing();
      }
      return;
    }
    awaitingProcessing = true;
  });

  that.enqueue = function(seq, payload){
    log('change queued ' + seq);
    queue[seq]= payload;
    if(!that.cancelled)
    {
      that.process();
    }
  };

  return that;
};