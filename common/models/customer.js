module.exports = function(Customer) {
	Customer.validatesUniquenessOf('phoneNumber');

    Customer.observe('before save', function(ctx, next){
        if(ctx.isNewInstance){
          ctx.instance.date = new Date();
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