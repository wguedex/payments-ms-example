import { Inject, Injectable, Logger } from '@nestjs/common';
import { envs } from 'src/config';
import Stripe from 'stripe';
import { PaymentSessionDTO } from './dto/payment-session.dto';
import { Request, Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';
import { NATS_SERVICE } from 'src/config/services';

@Injectable()
export class PaymentsService {

  private readonly stripe = new Stripe(envs.stripeSecret);
  private readonly logger = new Logger('PaymentsService');

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
  ){
    
  }

  async createPaymentSession(paymentSessionDTO: PaymentSessionDTO) {

    const { currency, items, orderId } = paymentSessionDTO;

    const line_items = items.map((item) => {
      return {
        price_data: {
          currency: currency,
          product_data: {
            name: item.name,
          },
          unit_amount: Math.round(item.price * 100), //Math para quitar decimales
        },
        quantity: item.quantity,
      };
    });

    const session = await this.stripe.checkout.sessions.create({
      // #Colocar aquì el ID de la orden
      payment_intent_data: {
        metadata: {
          orderId: orderId
        },
      },

      // #Colocar los items que las personas estàn comprando
      line_items: line_items,

      //# modalidad
      mode: 'payment',
      success_url: envs.stripeSuccessUrl,
      cancel_url: envs.stripeCancelUrl,
    });

    return session;
  }
 
  async stripeWebhook(req: Request, res: Response) {
    const sig = req.headers['stripe-signature'];
    
    let event: Stripe.Event;

    // This is your Stripe CLI webhook secret for testing your endpoint locally.
    const endpointSecret = envs.stripeEndpointSecret;

    try {
      event = this.stripe.webhooks.constructEvent(req['rawBody'], sig, endpointSecret);
    } catch (err) {
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    console.log({event})

    switch(event.type) {
      case 'charge.succeeded':
        const chargeSucceeded = event.data.object;
        //TODO: llamar nuestro microservicio
        // console.log({
        //   metadata:chargeSucceeded.metadata, 
        //   orderId:chargeSucceeded.metadata.orderId,  
        // })
        const payload = {
          stripePaymentId : chargeSucceeded.id, 
          orderId : chargeSucceeded.metadata.orderId, 
          receiptUrl : chargeSucceeded.receipt_url
        }
        // this.logger.log({payload})

        //no esperamos respuesta
        this.client.emit('payment.succeeded',payload)

        break;
      default:
        console.log(`Event ${event.type} not handled`)

    }

    return res.status(200).json({ sig });

  }
}
