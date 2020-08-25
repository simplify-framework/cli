import os
import sys
import json

import tflite_runtime.interpreter as tflite

def handler(event, context):

    interpreter = tflite.Interpreter(model_path="detect_object.tflite")
    interpreter.allocate_tensors()

    # Get input and output tensors.
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    print(input_details, output_details)

    return {
        'statusCode': 403, 
        'body': json.dumps(output_details)
    }
