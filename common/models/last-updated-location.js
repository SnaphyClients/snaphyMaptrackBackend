module.exports = function(LastUpdatedLocation) {
	LastUpdatedLocation.observe('before save', function(ctx, next){
        if(ctx.isNewInstance){
          next();
        }
        else{
        	var instance;
        	if(ctx.instance){
        		instance = ctx.instance;
        	}else if (ctx.data) {
        		instance = ctx.data;
        	}else{

        	}
        	
          instance.lastModified = new Date();	
          next();
        }
    });
};
